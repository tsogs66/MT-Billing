#!/usr/bin/env node
/*
 * MT-Billing Activator (vendor tool) — License + Password Reset
 *
 * Generates codes that match a customer's Hardware ID / Panel ID (same value):
 *   - License key  → paste on System → License
 *   - Reset code   → paste on login → Forgot password (account recovery)
 *
 * Compile to a Windows .exe with pkg (see package.json / README.md).
 *
 * Algorithms MUST match server/src/panelId.ts:
 *   expectedLicenseKey / expectedPasswordResetCode / normalizeCode
 */
'use strict';

const crypto = require('crypto');
const readline = require('readline');

const LICENSE_SECRET = 'MT-BILLING-LICENSE-2026';
const PASSWORD_RESET_SECRET = 'MT-BILLING-PASSWORD-RESET-2026';

/** Same as server/src/panelId.ts normalizeCode — strip hyphens/punctuation. */
function normalizeCode(k) {
  return String(k || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function licenseKeyFor(hwid) {
  const norm = normalizeCode(hwid);
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(norm).digest('hex').toUpperCase();
  return h.slice(0, 5) + '-' + h.slice(5, 10) + '-' + h.slice(10, 15) + '-' + h.slice(15, 20);
}

function resetCodeFor(hwid) {
  const norm = normalizeCode(hwid);
  const h = crypto.createHmac('sha256', PASSWORD_RESET_SECRET).update(norm).digest('hex').toUpperCase();
  return 'RST-' + h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16);
}

function printResult(hwid) {
  const id = String(hwid || '').toUpperCase().trim();
  const license = licenseKeyFor(id);
  const reset = resetCodeFor(id);
  console.log('');
  console.log('  ============================================');
  console.log('   MT-Billing Activator (License + Recovery)');
  console.log('  ============================================');
  console.log('   Hardware / Panel ID : ' + id);
  console.log('   License Key         : ' + license);
  console.log('   Password Reset Code : ' + reset);
  console.log('  ============================================');
  console.log('');
  console.log('  License  → customer pastes on System → License');
  console.log('  Recovery → customer pastes on login → Forgot password');
  console.log('  (Panel ID on Forgot password == Hardware ID on License)');
  console.log('');
}

function usage() {
  console.log('Usage:');
  console.log('  mt-billing-activator.exe <HARDWARE-OR-PANEL-ID>');
  console.log('  mt-billing-activator.exe                  (interactive)');
  console.log('  mt-billing-activator.exe --license <ID>   (license key only)');
  console.log('  mt-billing-activator.exe --reset <ID>     (password reset only)');
}

const args = process.argv.slice(2);
if (args[0] === '-h' || args[0] === '--help') {
  usage();
  process.exit(0);
}

if (args[0] === '--license' && args[1]) {
  const id = args[1];
  console.log('');
  console.log('  Hardware ID  : ' + String(id).toUpperCase().trim());
  console.log('  License Key  : ' + licenseKeyFor(id));
  console.log('');
} else if ((args[0] === '--reset' || args[0] === '--password-reset') && args[1]) {
  const id = args[1];
  console.log('');
  console.log('  Panel ID     : ' + String(id).toUpperCase().trim());
  console.log('  Reset Code   : ' + resetCodeFor(id));
  console.log('');
} else if (args[0] && !args[0].startsWith('-')) {
  printResult(args[0]);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the customer Hardware ID / Panel ID: ', (ans) => {
    printResult(ans.trim());
    rl.question('Press Enter to exit...', () => rl.close());
  });
}
