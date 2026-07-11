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

export type UpdateJobStatus = 'idle' | 'running' | 'updated' | 'current' | 'failed';

export interface UpdateJob {
  status: UpdateJobStatus;
  branch: string;
  from: string | null;
  to: string | null;
  at: string;
  message?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

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

function jobStatePath(installDir?: string): string {
  const root = installDir || resolveInstallDir();
  return path.join(root, 'server/data/.last-update.json');
}

function readUpdateJobRaw(installDir?: string): UpdateJob | null {
  try {
    const p = jobStatePath(installDir);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      status: (raw.status || 'idle') as UpdateJobStatus,
      branch: String(raw.branch || UPDATE_REPO.branch),
      from: raw.from ? String(raw.from) : null,
      to: raw.to ? String(raw.to) : null,
      at: String(raw.at || raw.finishedAt || raw.startedAt || new Date().toISOString()),
      message: raw.message != null ? String(raw.message) : null,
      startedAt: raw.startedAt ? String(raw.startedAt) : null,
      finishedAt: raw.finishedAt ? String(raw.finishedAt) : null,
    };
  } catch {
    return null;
  }
}

export function readUpdateJob(installDir?: string): UpdateJob | null {
  const job = readUpdateJobRaw(installDir);
  if (!job) return null;

  // Stale "running" left behind when preserve/restore or a crashed update
  // rewrote the job file — clear it once the API is serving again.
  if (job.status === 'running') {
    const started = Date.parse(job.startedAt || job.at || '');
    const ageMs = Number.isFinite(started) ? Date.now() - started : 0;
    if (ageMs > 3 * 60 * 1000) {
      return writeUpdateJob(
        {
          status: 'failed',
          from: job.from,
          to: job.to,
          message: 'Update marked failed — previous run did not finish cleanly (stale running state).',
          startedAt: job.startedAt,
        },
        installDir
      );
    }
  }
  return job;
}

export function writeUpdateJob(job: Partial<UpdateJob> & { status: UpdateJobStatus }, installDir?: string): UpdateJob {
  const root = installDir || resolveInstallDir();
  const dir = path.join(root, 'server/data');
  fs.mkdirSync(dir, { recursive: true });
  const prev = readUpdateJobRaw(root);
  const now = new Date().toISOString();
  const next: UpdateJob = {
    status: job.status,
    branch: job.branch || prev?.branch || UPDATE_REPO.branch,
    from: job.from !== undefined ? job.from : prev?.from || null,
    to: job.to !== undefined ? job.to : prev?.to || null,
    at: job.at || now,
    message: job.message !== undefined ? job.message : prev?.message || null,
    startedAt:
      job.startedAt !== undefined
        ? job.startedAt
        : job.status === 'running'
          ? now
          : prev?.startedAt || null,
    finishedAt:
      job.finishedAt !== undefined
        ? job.finishedAt
        : job.status === 'running'
          ? null
          : now,
  };
  fs.writeFileSync(jobStatePath(root), JSON.stringify(next, null, 0));
  return next;
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
  job: UpdateJob | null;
}

export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  const installDir = resolveInstallDir();
  const version = readPackageVersion(installDir);
  const currentSha = await localHead(installDir);
  const lastChecked = new Date().toISOString();
  const job = readUpdateJob(installDir);

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
    job,
  };
}

export async function applyUpdate(): Promise<{
  ok: boolean;
  message: string;
  queued?: boolean;
  job?: UpdateJob;
  targetSha?: string | null;
  fromSha?: string | null;
}> {
  const installDir = resolveInstallDir();
  const fromSha = await localHead(installDir);
  const remote = await fetchGithubJson(UPDATE_REPO.apiCommits());
  const targetSha = remote?.sha ? String(remote.sha) : null;

  const existing = readUpdateJob(installDir);
  if (existing?.status === 'running') {
    const started = existing.startedAt || existing.at;
    const age = started ? Date.now() - Date.parse(started) : 0;
    if (age > 0 && age < 20 * 60 * 1000) {
      return {
        ok: false,
        message: 'An update is already in progress. Wait for it to finish.',
        job: existing,
      };
    }
  }

  const job = writeUpdateJob(
    {
      status: 'running',
      branch: UPDATE_REPO.branch,
      from: fromSha,
      to: targetSha,
      message: `Updating from ${UPDATE_REPO.url} (${UPDATE_REPO.branch})…`,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    },
    installDir
  );

  dbLog(`Update from ${UPDATE_REPO.url} (${UPDATE_REPO.branch}) requested`);

  const scriptCandidates = [
    path.join(installDir, 'install/mt-billing-update.sh'),
    '/opt/mt-billing/install/mt-billing-update.sh',
  ];
  const script = scriptCandidates.find((p) => fs.existsSync(p));

  if (script) {
    // Fire-and-forget — script stops the API service and writes job status
    const child = spawn('bash', [script], {
      env: {
        ...process.env,
        INSTALL_DIR: installDir,
        REPO_URL: UPDATE_REPO.gitUrl,
        REPO_BRANCH: UPDATE_REPO.branch,
        var_install_dir: installDir,
        var_repo_url: UPDATE_REPO.gitUrl,
        var_repo_branch: UPDATE_REPO.branch,
        UPDATE_STARTED_AT: job.startedAt || new Date().toISOString(),
      },
      detached: true,
      stdio: 'ignore',
      cwd: installDir,
    });
    child.unref();
    return {
      ok: true,
      queued: true,
      job,
      fromSha,
      targetSha,
      message: `Update started from ${UPDATE_REPO.url} (${UPDATE_REPO.branch}). Keep this page open until it finishes.`,
    };
  }

  if (!fs.existsSync(path.join(installDir, '.git'))) {
    writeUpdateJob(
      {
        status: 'failed',
        from: fromSha,
        to: targetSha,
        message: `No update script and no git checkout at ${installDir}.`,
      },
      installDir
    );
    return {
      ok: false,
      message: `No update script and no git checkout at ${installDir}. Clone from ${UPDATE_REPO.gitUrl}.`,
      job: readUpdateJob(installDir) || undefined,
    };
  }

  // Dev / non-systemd fallback: git pull + rebuild in background
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
      const after = await localHead(installDir);
      writeUpdateJob(
        {
          status: 'updated',
          from: fromSha,
          to: after || targetSha,
          message: 'Update complete. Restarting API…',
        },
        installDir
      );
      dbLog(`Update pull complete from ${UPDATE_REPO.url}`);
      process.emit('mt-billing-restart' as any);
    } catch (e: any) {
      writeUpdateJob(
        {
          status: 'failed',
          from: fromSha,
          to: targetSha,
          message: e?.message || String(e),
        },
        installDir
      );
      dbLog(`Update failed: ${e?.message || e}`);
    }
  }, 500);

  return {
    ok: true,
    queued: true,
    job,
    fromSha,
    targetSha,
    message: `Pulling latest from ${UPDATE_REPO.url}. Keep this page open until it finishes.`,
  };
}

function dbLog(message: string) {
  try {
    import('./db.js')
      .then(({ db }) => {
        db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'updater', message);
      })
      .catch(() => undefined);
  } catch {
    /* ignore */
  }
}
