#!/usr/bin/env node
// MT-Billing standalone License Activator (vendor tool).
//
// The customer reads their Hardware ID from System → License, sends it to you,
// and you run this tool to generate the matching license key for them:
//
//   node server/scripts/license-activator.mjs <HARDWARE-ID>
//
// Example:
//   node server/scripts/license-activator.mjs 1A2B-3C4D-5E6F-7890
//
// The key algorithm and secret must match server/src/extra.ts.

import crypto from 'crypto';

const LICENSE_SECRET = 'MT-BILLING-LICENSE-2026';

function expectedKeyFor(hwid) {
  const norm = String(hwid || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(norm).digest('hex').toUpperCase();
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
