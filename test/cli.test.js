// SPDX-License-Identifier: MIT AND Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/proclaim-wallet.js', import.meta.url));
const run = (...args) => JSON.parse(execFileSync(process.execPath, [bin, ...args], { encoding: 'utf8' }));

test('CLI demo completes the full approval-gated lifecycle', () => {
  const r = run('demo', '--json');
  assert.equal(r.command, 'demo');
  assert.equal(r.prematureSignBlocked, true);
  assert.equal(r.authorized, true);
  assert.ok(r.receipt);
  assert.equal(r.finalState, 'submitted');
});

test('CLI attack holds every approval gate', () => {
  const r = run('attack', '--json');
  assert.equal(r.command, 'attack');
  assert.equal(r.allGatesHeld, true);
  assert.equal(r.results.length, 8);
  for (const x of r.results) assert.equal(x.held, true);
});

test('CLI capabilities and accounts return structured data', () => {
  assert.ok(run('capabilities', '--json').signTransaction.propose);
  assert.ok(run('accounts', '--json').length >= 2);
});
