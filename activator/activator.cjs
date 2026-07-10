#!/usr/bin/env node
/*
 * MT-Billing License Activator (vendor tool).
 *
 * Generates the license key that matches a customer's Hardware ID (shown in the
 * panel at System -> License). This file is compiled into a standalone Windows
 * .exe with pkg (see package.json / README.md) so it runs with a double-click,
 * no Node install required.
 *
 * The algorithm and secret must match server/src/extra.ts (expectedKeyFor).
 */
'use strict';

const crypto = require('crypto');
const readline = require('readline');

const LICENSE_SECRET = 'MT-BILLING-LICENSE-2026';

function keyFor(hwid) {
  const norm = String(hwid || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(norm).digest('hex').toUpperCase();
  return h.slice(0, 5) + '-' + h.slice(5, 10) + '-' + h.slice(10, 15) + '-' + h.slice(15, 20);
}

function printResult(hwid) {
  const key = keyFor(hwid);
  console.log('');
  console.log('  ================================');
  console.log('   MT-Billing License Activator');
  console.log('  ================================');
  console.log('   Hardware ID : ' + String(hwid).toUpperCase().trim());
  console.log('   License Key : ' + key);
  console.log('  ================================');
  console.log('');
}

const arg = process.argv[2];
if (arg) {
  // Command-line usage: activator.exe <HARDWARE-ID>
  printResult(arg);
} else {
  // Interactive usage (double-click): prompt, then keep the window open.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Enter the customer Hardware ID: ', (ans) => {
    printResult(ans.trim());
    rl.question('Press Enter to exit...', () => rl.close());
  });
}
