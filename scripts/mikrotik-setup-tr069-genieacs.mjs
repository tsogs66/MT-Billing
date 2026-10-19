#!/usr/bin/env node
/**
 * Apply MikroTik NAT + firewall for TR-069 (CWMP) to GenieACS for subscriber /ip pools.
 * Run from a host that can reach RouterOS API (e.g. MT-Billing LXC on 20.0.0.0/24).
 *
 * Example:
 *   bash scripts/mikrotik-setup-tr069-genieacs.sh \
 *     --host 20.0.0.1 --user admin --password 'secret' \
 *     --genieacs 192.168.0.107
 *
 * Env: MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD, GENIEACS_IP, ACS_FRONT_IP, MIKROTIK_PORT
 */
import { createRequire } from 'module';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const serverPkg = path.join(repoRoot, 'server', 'package.json');
const serverNm = path.join(repoRoot, 'server', 'node_modules', 'node-routeros');

if (!existsSync(serverNm)) {
  console.error(
    'Cannot find node-routeros. On the billing server run from repo root:\n' +
      '  cd /opt/mt-billing && git pull && npm install\n' +
      'Then run this script again (Linux shell, not MikroTik Terminal).'
  );
  process.exit(1);
}

const require = createRequire(serverPkg);
const { RouterOSAPI } = require('node-routeros');

const COMMENT = 'MT-Billing TR-069 GenieACS';
const LIST = 'tr069-cpe-pools';
const CWMP_PORT = 7547;

/** Skip management / captive pools (not subscriber PPPoE WAN). */
const SKIP_POOL_NAME = /^(LAN-POOL|non-payment|non-payments)$/i;
const SKIP_RANGE_PREFIX = /^(20\.0\.0\.|172\.15\.10\.)/;

function arg(name, envKey, def = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[envKey] || def;
}

function usage() {
  console.error(`Usage: bash scripts/mikrotik-setup-tr069-genieacs.sh \\
  --host <router> --user <api-user> --password <api-pass> \\
  --genieacs 192.168.0.107 [--acs-front <optional-single-IP>]`);
  process.exit(1);
}

const host = arg('host', 'MIKROTIK_HOST');
const user = arg('user', 'MIKROTIK_USER');
const password = arg('password', 'MIKROTIK_PASSWORD');
const genieacs = arg('genieacs', 'GENIEACS_IP', '192.168.0.107');
const acsFront = arg('acs-front', 'ACS_FRONT_IP');
const port = Number(arg('port', 'MIKROTIK_PORT', '8728')) || 8728;

if (!host || !user) usage();

const api = new RouterOSAPI({ host, port, user, password, timeout: 30 });
api.on('error', () => {});

function isEmptyReplyError(e) {
  const msg = String(e?.message || e || '');
  return msg.includes('!empty') || e?.errno === 'UNKNOWNREPLY';
}

/** node-routeros throws on MikroTik !empty replies when a print returns zero rows. */
async function rosWrite(...args) {
  try {
    return await api.write(...args);
  } catch (e) {
    if (isEmptyReplyError(e)) return [];
    throw e;
  }
}

async function rosPrint(path, args = []) {
  const rows = await rosWrite(path, ...args);
  if (!rows) return [];
  return Array.isArray(rows) ? rows : [rows];
}

async function connect() {
  await api.connect();
}

function filterSubscriberPools(pools) {
  const kept = [];
  const skipped = [];
  for (const p of pools || []) {
    const name = String(p.name || '');
    const ranges = String(p.ranges || '');
    if (SKIP_POOL_NAME.test(name) || SKIP_RANGE_PREFIX.test(ranges.trim())) {
      skipped.push(p);
      continue;
    }
    kept.push(p);
  }
  return { kept, skipped };
}

async function clearAddressList() {
  const all = await rosPrint('/ip/firewall/address-list/print');
  for (const r of all) {
    if (String(r.list || '') !== LIST || !r['.id']) continue;
    await rosWrite('/ip/firewall/address-list/remove', [`=.id=${r['.id']}`]);
  }
}

async function addPoolRangesToList(pools) {
  const added = [];
  for (const p of pools || []) {
    const name = String(p.name || '');
    const ranges = String(p.ranges || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const range of ranges) {
      await rosWrite('/ip/firewall/address-list/add', [
        `=list=${LIST}`,
        `=address=${range}`,
        `=comment=${COMMENT} pool:${name}`,
      ]);
      added.push({ pool: name, range });
    }
  }
  return added;
}

async function removeOldRules(firewallPath) {
  const all = await rosPrint(`${firewallPath}/print`);
  for (const r of all) {
    const c = String(r.comment || '');
    if (!c.includes('MT-Billing TR-069')) continue;
    if (r['.id']) await rosWrite(`${firewallPath}/remove`, [`=.id=${r['.id']}`]);
  }
}

async function ensureRules() {
  await removeOldRules('/ip/firewall/nat');
  await removeOldRules('/ip/firewall/filter');

  // Any subscriber hitting this router on CWMP port → GenieACS (works with many PPP .1 gateways).
  await rosWrite('/ip/firewall/nat/add', [
    '=chain=dstnat',
    '=protocol=tcp',
    `=dst-port=${CWMP_PORT}`,
    `=src-address-list=${LIST}`,
    '=action=dst-nat',
    `=to-addresses=${genieacs}`,
    `=to-ports=${CWMP_PORT}`,
    `=comment=${COMMENT} dst-nat port`,
  ]);

  if (acsFront) {
    await rosWrite('/ip/firewall/nat/add', [
      '=chain=dstnat',
      '=protocol=tcp',
      `=dst-address=${acsFront}`,
      `=dst-port=${CWMP_PORT}`,
      '=action=dst-nat',
      `=to-addresses=${genieacs}`,
      `=to-ports=${CWMP_PORT}`,
      `=comment=${COMMENT} dst-nat front`,
    ]);
  }

  await rosWrite('/ip/firewall/filter/add', [
    '=chain=forward',
    '=action=accept',
    '=protocol=tcp',
    `=dst-address=${genieacs}`,
    `=dst-port=${CWMP_PORT}`,
    `=src-address-list=${LIST}`,
    `=comment=${COMMENT} forward`,
  ]);

  await rosWrite('/ip/firewall/nat/add', [
    '=chain=srcnat',
    '=action=masquerade',
    '=protocol=tcp',
    `=dst-address=${genieacs}`,
    `=dst-port=${CWMP_PORT}`,
    `=src-address-list=${LIST}`,
    `=comment=${COMMENT} srcnat`,
  ]);
}

async function main() {
  console.log(`Connecting to ${host}:${port} as ${user}…`);
  await connect();
  const allPools = await rosPrint('/ip/pool/print');
  const { kept, skipped } = filterSubscriberPools(allPools);
  console.log(`Found ${allPools.length} IP pool(s), using ${kept.length} subscriber pool(s):`);
  for (const p of kept) console.log(`  - ${p.name}: ${p.ranges}`);
  for (const p of skipped) console.log(`  (skip) ${p.name}: ${p.ranges}`);

  console.log(`Refreshing address-list "${LIST}"…`);
  await clearAddressList();
  const added = await addPoolRangesToList(kept);
  if (!added.length) {
    console.warn('WARNING: No subscriber pool ranges — check /ip pool names.');
  } else {
    for (const a of added) console.log(`  + list ${LIST}: ${a.range} (${a.pool})`);
  }

  console.log('Applying NAT + forward rules…');
  await ensureRules();

  console.log('');
  console.log('=== Done ===');
  console.log(`GenieACS backend: ${genieacs}:${CWMP_PORT}`);
  console.log(`Huawei ACS URL: http://<PPP-gateway-for-that-subscriber>:${CWMP_PORT}/`);
  console.log('  (each profile local-address .1, e.g. 1.11.10.1 for 10mbps pool — check /ppp profile print)');
  if (acsFront) {
    console.log(`  Optional fixed front: http://${acsFront}:${CWMP_PORT}/`);
  }
  console.log(`MT-Billing CWMP ACS URL: use the gateway your ONTs use, or document per profile.`);
  api.close();
}

main().catch((e) => {
  console.error(e.message || e);
  try {
    api.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
