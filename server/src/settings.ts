import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { db, backupsDir, dbPath } from './db.js';
import { probeRouter } from './mikrotik.js';
import { panelHardwareId, expectedPasswordResetCode, normalizeCode } from './panelId.js';

export const settingsRouter = express.Router();

// ---------- Panel / app settings ----------
const SECRET_FIELDS = ['ngrok_authtoken', 'ai_api_key', 'cursor_api_key'];
const BOOL_FIELDS = ['ngrok_enabled', 'ai_enabled'];
const EDITABLE = [
  'theme', 'currency', 'ngrok_enabled', 'ngrok_authtoken', 'ngrok_region',
  'ngrok_port', 'ai_provider', 'ai_api_key', 'ai_model', 'ai_enabled', 'cursor_api_key',
  'cursor_model', 'cursor_repo_url', 'tz', 'ntp_server', 'public_base_url',
];

function getApp(): any {
  return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
}

function publicApp() {
  const s = getApp();
  const out: any = { ...s };
  for (const f of SECRET_FIELDS) {
    out[`${f}_set`] = !!s[f];
    delete out[f];
  }
  return out;
}

settingsRouter.get('/settings/app', (_req, res) => {
  res.json(publicApp());
});

settingsRouter.put('/settings/app', (req, res) => {
  const cur = getApp();
  const b = req.body || {};
  for (const f of EDITABLE) {
    if (!(f in b)) continue;
    if (SECRET_FIELDS.includes(f) && (b[f] == null || b[f] === '')) continue; // keep existing secret
    let v = b[f];
    if (BOOL_FIELDS.includes(f)) v = v ? 1 : 0;
    cur[f] = v;
  }
  // Normalize theme values
  const theme = ['light', 'dark', 'onepiece'].includes(cur.theme) ? cur.theme : 'light';
  db.prepare(
    `UPDATE app_settings SET theme=@theme, language=@language, currency=@currency,
       ngrok_enabled=@ngrok_enabled, ngrok_authtoken=@ngrok_authtoken, ngrok_region=@ngrok_region,
       ngrok_port=@ngrok_port, ai_provider=@ai_provider, ai_api_key=@ai_api_key, ai_model=@ai_model,
       ai_enabled=@ai_enabled, cursor_api_key=@cursor_api_key, cursor_model=@cursor_model,
       cursor_repo_url=@cursor_repo_url, tz=@tz, ntp_server=@ntp_server,
       public_base_url=@public_base_url WHERE id=1`
  ).run({
    theme,
    language: cur.language || 'en',
    currency: cur.currency || 'PHP',
    ngrok_enabled: cur.ngrok_enabled ? 1 : 0,
    ngrok_authtoken: cur.ngrok_authtoken || null,
    ngrok_region: cur.ngrok_region || 'ap',
    ngrok_port: Number(cur.ngrok_port) || 5173,
    ai_provider: cur.ai_provider || 'anthropic',
    ai_api_key: cur.ai_api_key || null,
    ai_model: cur.ai_model || 'claude-sonnet-4-20250514',
    ai_enabled: cur.ai_enabled ? 1 : 0,
    cursor_api_key: cur.cursor_api_key || null,
    cursor_model: cur.cursor_model || 'composer-2',
    cursor_repo_url: cur.cursor_repo_url || null,
    tz: cur.tz || 'Asia/Manila',
    ntp_server: cur.ntp_server || 'time.cloudflare.com',
    public_base_url: (() => { const v = cur.public_base_url == null ? '' : String(cur.public_base_url).trim().replace(/\/$/, ''); return v || null; })(),
  });
  res.json(publicApp());
});

// ---------- Ngrok remote access (config + simulated tunnel status) ----------
settingsRouter.post('/ngrok/toggle', (_req, res) => {
  const s = getApp();
  const starting = s.ngrok_status !== 'running';
  if (starting && !s.ngrok_authtoken) {
    return res.status(400).json({ error: 'Set your ngrok auth token first.' });
  }
  const status = starting ? 'running' : 'stopped';
  const url = starting ? `https://${Math.random().toString(36).slice(2, 10)}.${s.ngrok_region || 'ap'}.ngrok.io` : null;
  db.prepare('UPDATE app_settings SET ngrok_status = ?, ngrok_url = ? WHERE id = 1').run(status, url);
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'ngrok', `Tunnel ${status}${url ? ` at ${url}` : ''}`);
  res.json({ status, url });
});

// ---------- Database management ----------
settingsRouter.post('/db/backup', async (_req, res) => {
  try {
    const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    await db.backup(path.join(backupsDir, name));
    res.json({ ok: true, name });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'backup failed' });
  }
});

settingsRouter.get('/db/backups', (_req, res) => {
  const files = fs
    .readdirSync(backupsDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(backupsDir, f));
      return { name: f, size: st.size, created: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.created < b.created ? 1 : -1));
  res.json(files);
});

function safeBackupPath(name: string): string | null {
  const base = path.basename(name); // prevent path traversal
  if (!base.endsWith('.db')) return null;
  const full = path.join(backupsDir, base);
  return fs.existsSync(full) ? full : null;
}

settingsRouter.get('/db/backups/:name/download', (req, res) => {
  const full = safeBackupPath(req.params.name);
  if (!full) return res.status(404).json({ error: 'not found' });
  res.download(full);
});

settingsRouter.delete('/db/backups/:name', (req, res) => {
  const full = safeBackupPath(req.params.name);
  if (!full) return res.status(404).json({ error: 'not found' });
  fs.rmSync(full);
  res.json({ ok: true });
});

// Restore from an uploaded base64 SQLite file. Applied safely on next restart.
settingsRouter.post('/db/restore', (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'no file uploaded' });
  try {
    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const buf = Buffer.from(base64, 'base64');
    if (buf.slice(0, 15).toString('utf8') !== 'SQLite format 3') {
      return res.status(400).json({ error: 'not a valid SQLite database file' });
    }
    fs.writeFileSync(`${dbPath}.pending`, buf);
    db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('warning', 'database', 'Restore staged; will apply on next restart');
    res.json({ ok: true, restartRequired: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'restore failed' });
  }
});

// ---------- Time synchronization ----------
settingsRouter.get('/time', (_req, res) => {
  const s = getApp();
  res.json({ serverTime: new Date().toISOString(), tz: s.tz, ntp_server: s.ntp_server });
});

settingsRouter.post('/time/sync', (_req, res) => {
  const s = getApp();
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run('info', 'time', `NTP sync with ${s.ntp_server}`);
  res.json({ ok: true, serverTime: new Date().toISOString(), ntp_server: s.ntp_server });
});

// ---------- Account reset (require current password OR vendor recovery key) ----------
settingsRouter.post('/account/reset-password', (req: any, res) => {
  const { newPassword, currentPassword, recoveryKey } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  const username = req.user?.username;
  if (!username) return res.status(401).json({ error: 'Not authenticated.' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const hasCurrent = currentPassword != null && String(currentPassword).length > 0;
  const hasRecovery = recoveryKey != null && String(recoveryKey).trim().length > 0;
  if (!hasCurrent && !hasRecovery) {
    return res.status(400).json({
      error: 'Provide your current password or a password recovery key from the vendor activator.',
    });
  }

  let authorized = false;
  if (hasCurrent) {
    authorized = bcrypt.compareSync(String(currentPassword), user.password_hash);
    if (!authorized && !hasRecovery) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
  }
  if (!authorized && hasRecovery) {
    const hwid = panelHardwareId();
    const expected = normalizeCode(expectedPasswordResetCode(hwid));
    const provided = normalizeCode(String(recoveryKey));
    authorized = provided === expected;
    if (!authorized) {
      db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
        'warning',
        'account',
        `Invalid recovery key during password change for ${username}`
      );
      return res.status(401).json({ error: 'Invalid recovery key for this panel.' });
    }
  }

  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'warning',
    'account',
    `Password changed for ${username}${hasRecovery && !hasCurrent ? ' via recovery key' : ''}`
  );
  res.json({ ok: true });
});

// ---------- Server restart ----------
function scheduleApiRestart() {
  setTimeout(() => {
    exec('systemctl restart mt-billing-api 2>/dev/null', (sysErr) => {
      if (!sysErr) return; // systemd will stop this process

      exec('pm2 restart mt-billing 2>/dev/null || pm2 restart mt-billing-api 2>/dev/null', (pmErr) => {
        if (!pmErr) return;

        // Dev / manual: ask the HTTP server to close, then exit so `tsx watch` respawns us.
        // Emitting lets index.ts close sockets cleanly before exit.
        try {
          process.emit('mt-billing-restart' as any);
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          // Re-spawn ourselves if nothing is watching (plain `node dist/index.js`).
          const isTsx = process.argv.some((a) => a.includes('tsx'));
          if (!isTsx) {
            try {
              const child = spawn(process.execPath, process.argv.slice(1), {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd(),
                env: process.env,
              });
              child.unref();
            } catch {
              /* ignore */
            }
          }
          process.exit(1);
        }, 600);
      });
    });
  }, 500);
}

settingsRouter.post('/settings/restart-server', (_req, res) => {
  db.prepare('INSERT INTO logs (level, source, message) VALUES (?, ?, ?)').run(
    'warning',
    'server',
    'API server restart requested from System Settings'
  );
  res.json({ ok: true, message: 'Server is restarting. The panel may be unavailable for a few seconds.' });
  scheduleApiRestart();
});

// ---------- Router management (CRUD) ----------
settingsRouter.post('/routers/test', async (req, res) => {
  const b = req.body || {};
  const id = Number(b.id) || 0;
  const ex = id ? (db.prepare('SELECT * FROM routers WHERE id = ?').get(id) as any) : null;
  const conn = {
    host: b.host || ex?.host,
    port: Number(b.port) || ex?.port || 8728,
    api_user: b.api_user || ex?.api_user,
    api_pass: b.api_pass != null && b.api_pass !== '' ? b.api_pass : ex?.api_pass || '',
  };
  const result = await probeRouter(conn);
  res.json({
    online: result.online,
    status: result.online ? 'online' : 'offline',
    board: result.board,
    identity: result.identity,
    version: result.version,
    error: result.error,
  });
});

settingsRouter.post('/routers', async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const conn = {
    host: b.host,
    port: Number(b.port) || 8728,
    api_user: b.api_user,
    api_pass: b.api_pass || '',
  };
  const probe = await probeRouter(conn);
  const status = probe.online ? 'online' : 'offline';
  const board = probe.board || b.board || null;
  const info = db
    .prepare('INSERT INTO routers (name, host, port, ssh_port, api_user, api_pass, board, type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(b.name, b.host || null, Number(b.port) || 8728, Number(b.ssh_port) || 22, b.api_user || null, b.api_pass || null, board, b.type || 'pppoe', status);
  res.status(201).json(db.prepare('SELECT id, name, host, port, ssh_port, board, type, status FROM routers WHERE id = ?').get(info.lastInsertRowid));
});

settingsRouter.put('/routers/:id', async (req, res) => {
  const id = Number(req.params.id);
  const ex = db.prepare('SELECT * FROM routers WHERE id = ?').get(id) as any;
  if (!ex) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  const host = b.host ?? ex.host;
  const port = Number(b.port) || ex.port;
  const api_user = b.api_user ?? ex.api_user;
  const api_pass = b.api_pass != null && b.api_pass !== '' ? b.api_pass : ex.api_pass;
  const probe = await probeRouter({ host, port, api_user, api_pass });
  const status = probe.online ? 'online' : 'offline';
  const board = probe.board || b.board || ex.board;
  db.prepare('UPDATE routers SET name=?, host=?, port=?, ssh_port=?, api_user=?, api_pass=?, board=?, type=?, status=? WHERE id=?').run(
    b.name ?? ex.name,
    host,
    port,
    Number(b.ssh_port) || ex.ssh_port || 22,
    api_user,
    api_pass,
    board,
    b.type ?? ex.type,
    status,
    id
  );
  res.json(db.prepare('SELECT id, name, host, port, ssh_port, board, type, status FROM routers WHERE id = ?').get(id));
});

settingsRouter.delete('/routers/:id', (req, res) => {
  db.prepare('DELETE FROM routers WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
