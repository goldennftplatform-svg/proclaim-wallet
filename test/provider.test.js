// SPDX-License-Identifier: MIT AND Apache-2.0
// LP-0021 provider-surface tests. Run: node --test test/*.test.js
// Dependency-free: node:test + node:assert/strict only, no build step.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ProclaimWalletProvider,
  MockFundingProvider,
  MockProgramRegistry,
  MockIdlProvider,
  MockCoreAuthorizer,
  MockSigner,
  SUBMISSION_ID,
  CAPABILITIES,
  EFFECTS_FIELDS,
  sampleTransactionRequest,
  sampleProgramMeta,
  sampleVerificationStatus,
  sampleSimulationResult,
  verificationBadge,
} from '../src/provider.js';

function fixture(overrides = {}) {
  const FundingProvider = overrides.FundingProvider ?? new MockFundingProvider();
  const ProgramRegistry = overrides.ProgramRegistry ?? new MockProgramRegistry()
    .withProgram(sampleProgramMeta(), sampleVerificationStatus());
  const IdlProvider = overrides.IdlProvider ?? new MockIdlProvider()
    .withResult('testimonial-store', sampleSimulationResult());
  const CoreAuthorizer = overrides.CoreAuthorizer ?? new MockCoreAuthorizer();
  const Signer = overrides.Signer ?? new MockSigner();
  const provider = new ProclaimWalletProvider({
    FundingProvider, ProgramRegistry, IdlProvider, CoreAuthorizer, Signer,
  });
  return { provider, FundingProvider, ProgramRegistry, IdlProvider, CoreAuthorizer, Signer };
}

/** Grant the fixture's session/account, then call the real authorize() path. */
function grantAndAuthorize(f, proposalId, context = {}) {
  f.CoreAuthorizer.grant('session-1', 'alice');
  return f.provider.authorize(proposalId, context);
}

test('getCapabilities advertises accounts, signing, registry resolution and IDL preview', () => {
  const f = fixture();
  const caps = f.provider.getCapabilities();
  assert.equal(caps.accounts.list, true);
  assert.equal(caps.accounts.select, true);
  assert.deepEqual(caps.accounts.kinds, ['Public', 'Shielded']);
  assert.equal(caps.signTransaction.propose, true);
  assert.equal(caps.signTransaction.authorize, true);
  assert.equal(caps.signTransaction.reject, true);
  assert.equal(caps.signTransaction.signAndSubmit, true);
  assert.match(caps.signTransaction.approvalInvariant, /no signing without explicit authorize/);
  assert.equal(caps.registryResolution.resolve, true);
  assert.equal(caps.registryResolution.verificationStatus, true);
  assert.equal(caps.idlPreview.decodeAndSimulate, true);
  assert.equal(caps.idlPreview.humanReadableEffects, true);
  assert.equal(caps.idlPreview.rawCalldataFallback, true);
  assert.equal(caps.submissionId, SUBMISSION_ID);
  assert.deepEqual(caps.capabilities, [...CAPABILITIES]);
});

test('listAccounts and selectAccount expose account refs and reject unknown ids', () => {
  const f = fixture();
  const accounts = f.provider.listAccounts();
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].id, 'alice');
  assert.equal(accounts[0].kind, 'Public');
  assert.equal(accounts[1].id, 'bob');
  assert.equal(accounts[1].kind, 'Shielded');
  assert.equal(f.provider.selectedAccountId, null);

  assert.equal(f.provider.selectAccount('alice').id, 'alice');
  assert.equal(f.provider.selectedAccountId, 'alice');
  assert.throws(
    () => f.provider.selectAccount('does-not-exist'),
    (err) => err.code === 'UNKNOWN_ACCOUNT',
  );
});

test('proposeTransaction returns the full EffectsSummary preview and awaits approval', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());

  assert.match(proposal.id, /^req-\d+$/);
  assert.equal(proposal.state, 'awaiting_approval');
  assert.equal(proposal.warnings.length, 1);
  assert.equal(proposal.verification, 'Verified');
  assert.deepEqual(
    Object.keys(proposal.effects).sort(),
    EFFECTS_FIELDS.filter((field) => field !== 'toHumanLines').sort(),
  );

  const e = proposal.effects;
  assert.equal(e.requestingDapp, 'testimonial-app');
  assert.equal(e.session, 'session-1');
  assert.equal(e.targetAccount, 'alice');
  assert.equal(e.targetZone, 'lez-testnet-0.4');
  assert.equal(e.programId, 'testimonial-store');
  assert.equal(e.programName, 'testimonial_store');
  assert.equal(e.programVersion, '0.1.0');
  assert.equal(e.programAuthor, 'logos');
  assert.equal(e.destination, 'bob');
  assert.equal(e.amount, 500);
  assert.equal(e.effectsAvailable, true);
  assert.equal(e.unlimitedApproval, true);
  assert.equal(e.gasEstimate, 123);
  assert.equal(e.gasUsed, 120);
  assert.equal(e.feeEstimate, 7);
  assert.deepEqual(e.signersRequired, ['alice']);
  assert.equal(e.applies, true);
  assert.equal(e.asset.mint, 'mint-lp');
  assert.equal(e.approvalsGranted[0].unlimited, true);
  assert.equal(e.approvalsMoved[0].to, 'bob');
  assert.equal(e.verificationStatus.kind, 'LocallyVerified');
  assert.equal(e.verificationStatus.sourceCommit, 'abc123');
  assert.match(e.verificationDetail, /abc123/);
  assert.equal(e.rawCalldataHex, 'cafebabe');
  assert.ok(e.warnings.some((w) => w.includes('UNLIMITED token approval')));

  const lines = e.toHumanLines();
  assert.ok(lines.some((line) => line.includes('Destination: bob')));
  assert.ok(lines.some((line) => line.includes('UNLIMITED APPROVAL')));
  assert.ok(lines.some((line) => line.includes('Verification: locally source-verified')));
  assert.ok(lines.some((line) => line.includes('Raw calldata: 0xcafebabe')));
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 0, submitCalls: 0 });
});

test('positive lifecycle: propose, authorize, signAndSubmit', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  const token = grantAndAuthorize(f, proposal.id);

  assert.equal(typeof token, 'string');
  assert.equal(f.provider.stateOf(proposal.id), 'approved');
  assert.equal(f.provider.getProposal(proposal.id).stateName, 'Approved');

  const receipt = f.provider.signAndSubmit(proposal.id);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.requestId, proposal.id);
  assert.match(receipt.signatureHex, /^6d6f636b/);
  assert.equal(f.provider.getProposal(proposal.id).state, 'submitted');
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 1, submitCalls: 1 });
  assert.deepEqual(f.CoreAuthorizer.logSnapshot(), { calls: 1, grantsUsed: 1 });
});

test('negative: signing before explicit authorize is blocked, adapters untouched', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());

  assert.throws(
    () => f.provider.signAndSubmit(proposal.id),
    (err) => err.code === 'NOT_APPROVED' && err.actual === 'awaiting_approval',
  );
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 0, submitCalls: 0 });
  assert.equal(f.CoreAuthorizer.logSnapshot().calls, 0);
  assert.equal(f.provider.getProposal(proposal.id).state, 'awaiting_approval');
});

test('negative: rejected proposal is permanently unsigned', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  f.CoreAuthorizer.grant('session-1', 'alice');

  const rejected = f.provider.reject(proposal.id, 'user changed mind');
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.reason, 'user changed mind');
  assert.throws(
    () => f.provider.signAndSubmit(proposal.id),
    (err) => err.code === 'NOT_APPROVED' && err.actual === 'rejected',
  );
  assert.throws(() => f.provider.authorize(proposal.id), (err) => err.kind === 'InvalidState');
  assert.throws(() => f.provider.reject(proposal.id), (err) => err.code === 'INVALID_STATE');
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 0, submitCalls: 0 });
});

test('negative: double authorize and sign replay are blocked', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  grantAndAuthorize(f, proposal.id);

  assert.throws(() => f.provider.authorize(proposal.id), (err) => err.kind === 'InvalidState');
  assert.equal(f.provider.signAndSubmit(proposal.id).accepted, true);
  assert.throws(
    () => f.provider.signAndSubmit(proposal.id),
    (err) => err.code === 'NOT_APPROVED' && err.actual === 'submitted',
  );
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 1, submitCalls: 1 });
});

test('negative: deny-all CoreAuthorizer cannot be bypassed, even with a forged token', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());

  assert.equal(f.CoreAuthorizer.logSnapshot().calls, 0);
  assert.throws(() => f.provider.authorize(proposal.id), (err) => err.kind === 'UserRejected');
  assert.equal(f.provider.getProposal(proposal.id).state, 'awaiting_approval');
  assert.throws(() => f.provider.signAndSubmit(proposal.id), (err) => err.code === 'NOT_APPROVED');
  assert.throws(
    () => f.provider.signAndSubmit(proposal.id, 'forged-token'),
    (err) => err.code === 'NOT_APPROVED',
  );
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 0, submitCalls: 0 });
  assert.deepEqual(f.CoreAuthorizer.logSnapshot(), { calls: 1, grantsUsed: 0 });
});

test('registry + IDL failures degrade to raw calldata, warn, and still gate signing', () => {
  const f = fixture({
    ProgramRegistry: new MockProgramRegistry().failing('Unavailable'),
    IdlProvider: new MockIdlProvider().failing(),
  });
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());

  assert.equal(proposal.effects.effectsAvailable, false);
  assert.equal(proposal.verification, 'Unavailable');
  assert.equal(proposal.effects.verificationStatus.kind, 'Unregistered');
  assert.equal(proposal.effects.programName, null);
  assert.equal(proposal.effects.rawCalldataHex, 'cafebabe');
  assert.ok(proposal.warnings.some((w) => w.includes('registry lookup failed')));
  assert.ok(proposal.warnings.some((w) => w.includes('cannot render effects')));
  assert.ok(proposal.effects.toHumanLines().some((l) => l.includes('raw calldata only')));
  assert.ok(proposal.effects.toHumanLines().some((l) => l.includes('WARNING: registry lookup failed')));

  assert.throws(
    () => f.provider.signAndSubmit(proposal.id),
    (err) => err.code === 'NOT_APPROVED',
  );
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 0, submitCalls: 0 });

  // Degradation is never silent approval: an explicit authorize is still required.
  grantAndAuthorize(f, proposal.id);
  assert.equal(f.provider.getProposal(proposal.id).state, 'approved');
  assert.ok(f.provider.getProposal(proposal.id).effects.warnings.some((w) => w.includes('IDL unavailable')));
  assert.equal(f.provider.signAndSubmit(proposal.id).accepted, true);
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 1, submitCalls: 1 });
});

test('unregistered program is not silently approved', () => {
  const f = fixture({ ProgramRegistry: new MockProgramRegistry() });
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());

  assert.equal(proposal.verification, 'Unregistered');
  assert.equal(proposal.effects.verificationStatus.kind, 'Unregistered');
  assert.equal(proposal.effects.programName, null);
  assert.equal(proposal.effects.verificationDetail, null);
  assert.ok(proposal.warnings.some((w) => w.includes('program not found')));
  assert.throws(() => f.provider.signAndSubmit(proposal.id), (err) => err.code === 'NOT_APPROVED');
  assert.equal(f.Signer.logSnapshot().signCalls, 0);
});

test('mismatch verification is flagged in the preview and human-readable lines', () => {
  const f = fixture({
    ProgramRegistry: new MockProgramRegistry()
      .withProgram(sampleProgramMeta(), { kind: 'Mismatch' }),
  });
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());

  assert.equal(proposal.verification, 'Mismatch');
  assert.equal(verificationBadge({ kind: 'Mismatch' }), 'source mismatch — high risk');
  assert.ok(proposal.warnings.some((w) => w.includes('source image does not match')));
  assert.ok(proposal.effects.toHumanLines().some((l) => l.includes('source mismatch')));
  assert.ok(proposal.effects.toHumanLines().some((l) => l.includes('WARNING: program source image')));
});

test('wrong account is denied at authorize', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  f.CoreAuthorizer.grant('session-1', 'alice');

  assert.throws(
    () => f.provider.authorize(proposal.id, { account: 'bob' }),
    (err) => err.kind === 'AccountMismatch',
  );
  assert.throws(
    () => f.provider.authorize(proposal.id, { account: 'charlie' }),
    (err) => err.kind === 'AccountMismatch',
  );
  f.provider.selectAccount('bob');
  assert.throws(
    () => f.provider.authorize(proposal.id),
    (err) => err.kind === 'AccountMismatch',
  );
  assert.equal(f.provider.getProposal(proposal.id).state, 'awaiting_approval');
  assert.equal(f.Signer.logSnapshot().signCalls, 0);
});

test('wrong session is denied at authorize', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  f.CoreAuthorizer.grant('session-1', 'alice');

  assert.throws(
    () => f.provider.authorize(proposal.id, { session: 'other-session' }),
    (err) => err.kind === 'NoSession',
  );
  assert.equal(f.provider.getProposal(proposal.id).state, 'awaiting_approval');
  assert.equal(f.Signer.logSnapshot().signCalls, 0);
});

test('wrong capability is denied at authorize', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  f.CoreAuthorizer.grant('session-1', 'alice');

  for (const capability of ['AccountAccess', 'ReadBalances', 'GetVerificationStatus']) {
    assert.throws(
      () => f.provider.authorize(proposal.id, { capability }),
      (err) => err.kind === 'CapabilityNotGranted' && err.capability === capability,
    );
  }
  assert.equal(f.provider.getProposal(proposal.id).state, 'awaiting_approval');
  assert.equal(f.CoreAuthorizer.logSnapshot().calls, 0);
});

test('submit failure marks the state failed and blocks replay', () => {
  const f = fixture({ Signer: new MockSigner().failingSubmit() });
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  grantAndAuthorize(f, proposal.id);

  assert.throws(() => f.provider.signAndSubmit(proposal.id), (err) => err.code === 'SIGNER');
  assert.equal(f.provider.getProposal(proposal.id).state, 'failed');
  assert.throws(() => f.provider.signAndSubmit(proposal.id), (err) => err.code === 'NOT_APPROVED');
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 1, submitCalls: 1 });
  assert.throws(
    () => f.provider.effectsPreview(proposal.id),
    (err) => err.code === 'INVALID_STATE',
  );
});

test('proposal ids are unique and unknown requests are rejected', () => {
  const f = fixture();
  const a = f.provider.proposeTransaction(sampleTransactionRequest());
  const b = f.provider.proposeTransaction(sampleTransactionRequest());
  assert.notEqual(a.id, b.id);

  assert.throws(() => f.provider.stateOf('req-nope'), (err) => err.code === 'UNKNOWN_REQUEST');
  assert.throws(() => f.provider.getProposal('req-nope'), (err) => err.code === 'UNKNOWN_REQUEST');
  assert.throws(() => f.provider.authorize('req-nope'), (err) => err.code === 'UNKNOWN_REQUEST');
  assert.throws(() => f.provider.signAndSubmit('req-nope'), (err) => err.code === 'UNKNOWN_REQUEST');
});

test('FundingProvider adapter is used for funding options and requests', () => {
  const f = fixture();
  const options = f.provider.getFundingOptions();
  assert.deepEqual(options, [{ id: 'faucet', label: 'LEZ testnet faucet (mock)' }]);
  assert.equal(f.FundingProvider.logSnapshot().optionCalls, 1);

  const receipt = f.provider.requestFunding({ optionId: 'faucet', amount: 1000 });
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.amount, 1000);
  assert.deepEqual(f.FundingProvider.logSnapshot().requests, [
    { account: null, optionId: 'faucet', amount: 1000 },
  ]);
});

test('all structured verification statuses map to the five UI badges', () => {
  const cases = [
    [{ kind: 'Unregistered' }, 'Unregistered'],
    [{ kind: 'RegisteredUnverified' }, 'Pending'],
    [{ kind: 'DeployerClaimUnverified' }, 'Pending'],
    [sampleVerificationStatus(), 'Verified'],
    [{ kind: 'Mismatch' }, 'Mismatch'],
  ];
  for (const [status, badge] of cases) {
    const f = fixture({
      ProgramRegistry: new MockProgramRegistry().withProgram(sampleProgramMeta(), status),
    });
    const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
    assert.equal(proposal.verification, badge);
    assert.equal(proposal.effects.verificationStatus.kind, status.kind);
  }
});

test('a dApp cannot bypass the gate by mutating the returned snapshot', () => {
  const f = fixture();
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  proposal.state = 'approved';
  proposal.effects.warnings.push('forged warning');
  proposal.effects.effectsAvailable = true;
  proposal.verification = 'Verified';

  const internal = f.provider.getProposal(proposal.id);
  assert.equal(internal.state, 'awaiting_approval');
  assert.ok(!internal.effects.warnings.includes('forged warning'));
  assert.equal(internal.effects.effectsAvailable, true); // was already true in this fixture
  assert.throws(() => f.provider.signAndSubmit(proposal.id), (err) => err.code === 'NOT_APPROVED');
  assert.deepEqual(f.Signer.logSnapshot(), { signCalls: 0, submitCalls: 0 });
});

test('revert simulation and note warnings are surfaced without changing the gate', () => {
  const f = fixture({
    IdlProvider: new MockIdlProvider().withResult('testimonial-store', sampleSimulationResult({
      applies: false,
      notes: ['simulated note: actor count 1'],
      unlimitedApproval: false,
      approvalsGranted: [],
    })),
  });
  const proposal = f.provider.proposeTransaction(sampleTransactionRequest());
  assert.ok(proposal.warnings.some((w) => w.includes('simulated note: actor count 1')));
  assert.ok(proposal.warnings.some((w) => w.includes('call will revert')));
  assert.ok(proposal.effects.toHumanLines().some((l) => l.includes('Simulation: reverts')));
  assert.equal(proposal.state, 'awaiting_approval');
  assert.throws(() => f.provider.signAndSubmit(proposal.id), (err) => err.code === 'NOT_APPROVED');
});
