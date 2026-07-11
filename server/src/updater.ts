import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

/** Canonical public repo for panel updates. */
export const UPDATE_REPO = {
  owner: 'tsogs66',
  name: 'MT-Billing',
  branch: process.env.MT_UPDATE_BRANCH || process.env.REPO_BRANCH || 'main',
  url: 'https://github.com/tsogs66/MT-Billing',
  gitUrl: process.env.REPO_URL || 'https://github.com/tsogs66/MT-Billing.git',
  apiCommits: () =>
    `https://api.github.com/repos/tsogs66/MT-Billing/commits/${UPDATE_REPO.branch}`,
  apiCompare: (base: string, head: string) =>
    `https://api.github.com/repos/tsogs66/MT-Billing/compare/${base}...${head}`,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve install root (git checkout). Prefer env, then /opt/mt-billing, then repo root. */
export function resolveInstallDir(): string {
  if (process.env.INSTALL_DIR && fs.existsSync(path.join(process.env.INSTALL_DIR, '.git'))) {
    return process.env.INSTALL_DIR;
  }
  if (fs.existsSync('/opt/mt-billing/.git')) return '/opt/mt-billing';
  // server/src → ../../
  const root = path.resolve(__dirname, '../..');
  if (fs.existsSync(path.join(root, '.git'))) return root;
  return root;
}

function readPackageVersion(installDir: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(installDir, 'package.json'), 'utf8'));
    return String(pkg.version || '1.0.0');
  } catch {
    return '1.0.0';
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 60_000 });
  return String(stdout || '').trim();
}

async function localHead(installDir: string): Promise<string | null> {
  try {
    if (!fs.existsSync(path.join(installDir, '.git'))) return null;
    return await git(installDir, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

async function fetchGithubJson(url: string): Promise<any | null> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'MT-Billing-Updater',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface UpdaterStatus {
  current: string;
  latest: string;
  updateAvailable: boolean;
  changelog: string[];
  lastChecked: string;
  repo: string;
  branch: string;
  currentSha: string | null;
  latestSha: string | null;
  installDir: string;
  source: 'github' | 'local-git' | 'unknown';
  error?: string | null;
}

export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  const installDir = resolveInstallDir();
  const version = readPackageVersion(installDir);
  const currentSha = await localHead(installDir);
  const lastChecked = new Date().toISOString();

  const remote = await fetchGithubJson(UPDATE_REPO.apiCommits());
  const latestSha = remote?.sha ? String(remote.sha) : null;
  const latestMsg = remote?.commit?.message
    ? String(remote.commit.message).split('\n')[0].slice(0, 120)
    : null;

  let updateAvailable = false;
  let changelog: string[] = [];
  let source: UpdaterStatus['source'] = 'unknown';
  let error: string | null = null;

  if (latestSha) {
    source = 'github';
    if (currentSha) {
      updateAvailable = currentSha.toLowerCase() !== latestSha.toLowerCase();
      if (updateAvailable) {
        const cmp = await fetchGithubJson(UPDATE_REPO.apiCompare(currentSha, latestSha));
        const commits = Array.isArray(cmp?.commits) ? cmp.commits : [];
        changelog = commits
          .slice(-15)
          .reverse()
          .map((c: any) => String(c?.commit?.message || '').split('\n')[0].trim())
          .filter(Boolean);
        if (!changelog.length && latestMsg) changelog = [latestMsg];
      } else {
        changelog = ['Already on the latest commit from GitHub.'];
      }
    } else {
      // No local git — treat remote tip as available update info
      updateAvailable = true;
      changelog = latestMsg
        ? [latestMsg, 'Local install has no .git — apply will use the guest update script if present.']
        : ['Update available from GitHub (local SHA unknown).'];
    }
  } else if (currentSha) {
    source = 'local-git';
    error = 'Could not reach GitHub API. Showing local checkout only.';
    changelog = ['Unable to fetch https://github.com/tsogs66/MT-Billing — check outbound HTTPS.'];
  } else {
    error = 'Could not determine local or remote version.';
    changelog = ['Updater could not read local git or GitHub.'];
  }

  const short = (sha: string | null) => (sha ? sha.slice(0, 7) : '—');
  return {
    current: currentSha ? `${version} (${short(currentSha)})` : version,
    latest: latestSha ? `${version} (${short(latestSha)})` : version,
    updateAvailable,
    changelog,
    lastChecked,
    repo: UPDATE_REPO.url,
    branch: UPDATE_REPO.branch,
    currentSha,
    latestSha,
    installDir,
    source,
    error,
  };
}

export async function applyUpdate(): Promise<{ ok: boolean; message: string; queued?: boolean }> {
  const installDir = resolveInstallDir();
  const scriptCandidates = [
    path.join(installDir, 'install/mt-billing-update.sh'),
    '/opt/mt-billing/install/mt-billing-update.sh',
  ];
  const script = scriptCandidates.find((p) => fs.existsSync(p));

  dbLog(`Update from ${UPDATE_REPO.url} (${UPDATE_REPO.branch}) requested`);

  if (script) {
    // Fire-and-forget — script stops the API service
    const child = spawn('bash', [script], {
      env: {
        ...process.env,
        INSTALL_DIR: installDir,
        REPO_URL: UPDATE_REPO.gitUrl,
        REPO_BRANCH: UPDATE_REPO.branch,
        var_install_dir: installDir,
        var_repo_url: UPDATE_REPO.gitUrl,
        var_repo_branch: UPDATE_REPO.branch,
      },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return {
      ok: true,
      queued: true,
      message: `Update started from ${UPDATE_REPO.url} (${UPDATE_REPO.branch}). The panel will restart shortly.`,
    };
  }

  // Dev / non-systemd fallback: git pull + rebuild in background
  if (!fs.existsSync(path.join(installDir, '.git'))) {
    return {
      ok: false,
      message: `No update script and no git checkout at ${installDir}. Clone from ${UPDATE_REPO.gitUrl}.`,
    };
  }

  setTimeout(async () => {
    try {
      await git(installDir, ['remote', 'set-url', 'origin', UPDATE_REPO.gitUrl]);
      await git(installDir, ['fetch', 'origin', UPDATE_REPO.branch]);
      await git(installDir, ['checkout', UPDATE_REPO.branch]);
      await git(installDir, ['pull', '--ff-only', 'origin', UPDATE_REPO.branch]);
      await execFileAsync('npm', ['install'], { cwd: installDir, timeout: 600_000 });
      await execFileAsync('npm', ['run', 'build'], { cwd: installDir, timeout: 600_000 });
      await execFileAsync('npm', ['--prefix', 'server', 'run', 'build'], {
        cwd: installDir,
        timeout: 300_000,
      });
      dbLog(`Update pull complete from ${UPDATE_REPO.url}`);
      // Soft restart signal used elsewhere in the app
      process.emit('mt-billing-restart' as any);
    } catch (e: any) {
      dbLog(`Update failed: ${e?.message || e}`);
    }
  }, 500);

  return {
    ok: true,
    queued: true,
    message: `Pulling latest from ${UPDATE_REPO.url}. Panel will rebuild and restart.`,
  };
}

function dbLog(message: string) {
  try {
    // Lazy import to keep this module usable in isolation
    import('./db.js').then(({ db }) => {
      db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'updater', message);
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}
