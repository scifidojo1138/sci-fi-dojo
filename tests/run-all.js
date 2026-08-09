#!/usr/bin/env node
// Runs every *.test.js in this folder. Usage:
//   node tests/run-all.js
//   SFD_BACKEND=/path/to/sfd-backend.txt node tests/run-all.js
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let total = 0; const failed = [];
files.forEach((f) => {
  const result = require(path.join(__dirname, f))();
  total += result.pass;
  result.failures.forEach((label) => failed.push(f + ': ' + label));
});

console.log('\n' + '='.repeat(60));
console.log(`${files.length} suites, ${total} assertions, ${failed.length} failed`);
if (failed.length) {
  failed.forEach((f) => console.log('  FAIL ' + f));
  process.exit(1);
}
