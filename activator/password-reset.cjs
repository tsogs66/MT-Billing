#!/usr/bin/env node
/*
 * MT-Billing Password Reset Activator (vendor tool).
 *
 * Generates the reset code for a customer's Panel ID (shown on the login
 * "Forgot password" screen). Compile to .exe with pkg like the license activator.
 *
 * Algorithm must match server/src/panelId.ts (expectedPasswordResetCode).
 */
'use strict';

const crypto = require('crypto');
const readline = require('readline');

const PASSWORD_RESET_SECRET = 'MT-BILLING-PASSWORD-RESET-2026';

function normalizeCode(k) {
  return String(k || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function resetCodeFor(hwid) {
  const norm = normalizeCode(hwid);
  const h = crypto.createHmac('sha256', PASSWORD_RESET_SECRET).update(norm).digest('hex').toUpperCase();
  return 'RST-' + h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16);
}

function printResult(panelId) {
  const code = resetCodeFor(panelId);
  console.log('');
  console.log('  ========================================');
  console.log('   MT-Billing Password Reset Activator');
  console.log('  ========================================');
  console.log('   Panel ID   : ' + String(panelId).toUpperCase().trim());
  console.log('   Reset Code : ' + code);
  console.log('  ========================================');
  console.log('');
  console.log('  Customer enters this code on the login page');
  console.log('  to restore default admin credentials.');
  console.log('');
}

const arg = process.argv[2];
if (arg) {
  printResult(arg);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the customer Panel ID: ', (ans) => {
    printResult(ans.trim());
    rl.question('Press Enter to exit...', () => rl.close());
  });
}
