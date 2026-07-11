#!/usr/bin/env node
// MT-Billing License Activator (CLI) — must match server/src/panelId.ts
//
//   node server/scripts/license-activator.mjs <HARDWARE-ID>
//
// Prefer the unified vendor tool: activator/activator.cjs (license + password reset).

import crypto from 'crypto';

const LICENSE_SECRET = 'MT-BILLING-LICENSE-2026';

function normalizeCode(k) {
  return String(k || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function expectedKeyFor(hwid) {
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(normalizeCode(hwid)).digest('hex').toUpperCase();
  return `${h.slice(0, 5)}-${h.slice(5, 10)}-${h.slice(10, 15)}-${h.slice(15, 20)}`;
}

const hwid = process.argv[2];
if (!hwid) {
  console.error('Usage: node server/scripts/license-activator.mjs <HARDWARE-ID>');
  process.exit(1);
}

console.log('');
console.log('  Hardware ID : ' + hwid.toUpperCase());
console.log('  License Key : ' + expectedKeyFor(hwid));
console.log('');
