#!/usr/bin/env node
// SPDX-License-Identifier: MIT AND Apache-2.0
import {
  ProclaimWalletProvider, MockCoreAuthorizer, MockSigner,
  MockProgramRegistry, MockIdlProvider,
  sampleTransactionRequest, sampleProgramMeta, sampleVerificationStatus,
  sampleSimulationResult, effectsToHumanLines,
} from '../src/provider.js';

const command = process.argv[2] || 'help';
const asJson = process.argv.includes('--json');
const out = (obj) => console.log(JSON.stringify(obj, null, 2));
const die = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

// Same fixture the SDK tests use: a registered program, an IDL result, and a
// CoreAuthorizer that grants exactly one session/account. A grant is the user's
// explicit consent; without it authorize() must fail.
function fresh() {
  const CoreAuthorizer = new MockCoreAuthorizer();
  return {
    w: new ProclaimWalletProvider({
      ProgramRegistry: new MockProgramRegistry().withProgram(sampleProgramMeta(), sampleVerificationStatus()),
      IdlProvider: new MockIdlProvider().withResult('testimonial-store', sampleSimulationResult()),
      CoreAuthorizer,
      Signer: new MockSigner(),
    }),
    CoreAuthorizer,
  };
}

function demo() {
  const { w, CoreAuthorizer } = fresh();
  const account = w.listAccounts()[0];
  w.selectAccount(account.id);
  const proposal = w.proposeTransaction(sampleTransactionRequest());
  const trial = { account: account.id, proposal: proposal.id, state: proposal.state };
  let prematureSign;
  try { w.signAndSubmit(proposal.id); prematureSign = 'UNEXPECTED_SUCCESS'; }
  catch (e) { prematureSign = `${e.code || e.name}: ${e.message}`; }
  const effects = effectsToHumanLines(w.getEffectsPreview(proposal.id));
  CoreAuthorizer.grant(proposal.request.session, account.id);
  const token = w.authorize(proposal.id, { session: proposal.request.session, account: account.id });
  const receipt = w.signAndSubmit(proposal.id);
  out({ command: 'demo', trial, prematureSignBlocked: prematureSign !== 'UNEXPECTED_SUCCESS',
         prematureSign, effects, authorized: !!token, receipt,
         finalState: w.stateOf(proposal.id) });
}

function attack() {
  const { w, CoreAuthorizer } = fresh();
  const account = w.listAccounts()[0];
  w.selectAccount(account.id);
  const results = [];
  const attempt = (name, fn) => {
    try { fn(); results.push({ name, held: false, detail: 'NO ERROR — GATE FAILED' }); }
    catch (e) { results.push({ name, held: true, detail: `${e.code || e.name}: ${e.message}` }); }
  };
  const p1 = w.proposeTransaction(sampleTransactionRequest());
  attempt('sign before authorize', () => w.signAndSubmit(p1.id));
  attempt('authorize with wrong capability', () => w.authorize(p1.id, { capability: 'StealFunds' }));
  attempt('authorize with wrong account', () => w.authorize(p1.id, { account: 'unknown-account' }));
  attempt('authorize with wrong session', () => w.authorize(p1.id, { session: 'not-the-session' }));
  w.reject(p1.id, 'test rejection');
  attempt('sign a rejected proposal', () => w.signAndSubmit(p1.id));
  const p2 = w.proposeTransaction(sampleTransactionRequest());
  CoreAuthorizer.grant(p2.request.session, account.id);
  const token = w.authorize(p2.id, { session: p2.request.session, account: account.id });
  attempt('double authorize', () => w.authorize(p2.id, { session: p2.request.session, account: account.id }));
  w.signAndSubmit(p2.id);
  attempt('replay signAndSubmit', () => w.signAndSubmit(p2.id));
  const p3 = w.proposeTransaction(sampleTransactionRequest());
  CoreAuthorizer.denyAll(); // consent explicitly revoked before signing
  attempt('authorize after consent revoked', () => w.authorize(p3.id, { session: p3.request.session, account: account.id }));
  const allHeld = results.every((r) => r.held);
  out({ command: 'attack', allGatesHeld: allHeld, results });
  if (!allHeld) process.exit(1);
}

switch (command) {
  case 'capabilities': out(fresh().w.getCapabilities()); break;
  case 'accounts': out(fresh().w.listAccounts()); break;
  case 'demo': demo(); break;
  case 'attack': attack(); break;
  case 'help':
    console.log('proclaim-wallet — LP-0021 reference CLI (mock adapters, local only)');
    console.log('commands: capabilities | accounts | demo | attack [--json]');
    console.log('demo  = propose, blocked premature sign, human-readable effects, authorize, submit');
    console.log('attack= 8 negative cases; exits 1 if any approval gate fails');
    break;
  default: die(`unknown command: ${command}`);
}
