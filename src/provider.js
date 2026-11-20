// SPDX-License-Identifier: MIT AND Apache-2.0
// LP-0021 dependency-free Wallet Provider client (Phase 0 provider surface).
//
// This is the runnable, zero-build-step JavaScript implementation. `provider.ts`
// is the hand-maintained TypeScript mirror of the same public API. No npm
// dependencies, no network, no chain, no keystore and no real cryptography.
//
// The approval invariant is enforced here, exactly as in wallet-core: a
// proposal is born `awaiting_approval`, only `authorize()` may move it to
// `approved`, and `signAndSubmit()` refuses every other state before touching
// an injected Signer.

/**
 * @typedef {'Public' | 'Shielded'} AccountKind
 * @typedef {'AccountAccess' | 'ReadBalances' | 'ProposeTransaction' | 'GetVerificationStatus'} Capability
 * @typedef {'Verified' | 'Mismatch' | 'Unregistered' | 'Unavailable' | 'Pending'} VerificationBadge
 * @typedef {{id: string, kind: AccountKind, label: string, zone: string}} AccountRef
 * @typedef {{kind: 'Unregistered'} | {kind: 'RegisteredUnverified'} |
 *   {kind: 'LocallyVerified', sourceCommit: string, imageId: string} |
 *   {kind: 'DeployerClaimUnverified'} | {kind: 'Mismatch'}} VerificationStatus
 * @typedef {{programId: string, name: string, version: string, author: string,
 *   description: string, idlPointer: string | null, codePointer: string | null,
 *   registeredAt: string | null, deployerSigned: boolean}} ProgramMeta
 * @typedef {{programId?: string, mint: string, amount: number | bigint, decimals: number}} Asset
 * @typedef {{owner: string, spender: string, mint: string, amount: number | bigint | null, unlimited: boolean}} ApprovalGrant
 * @typedef {{from: string, to: string, programId: string, mint: string, amount: number | bigint}} AssetMovement
 * @typedef {{effectsAvailable: boolean, asset: Asset | null, destination: string | null,
 *   approvalsGranted: ApprovalGrant[], approvalsMoved: AssetMovement[],
 *   unlimitedApproval: boolean, gasEstimate: number | null, gasUsed: number | null,
 *   actorsDeclared: string[], signersRequired: string[], applies: boolean | null,
 *   feeEstimate: number | bigint | null, notes: string[]}} SimulationResult
 * @typedef {{dappId: string, session: string, programId: string, message: number[] | Uint8Array | string,
 *   declaredActors: string[], feePayer: string, value: Asset | null}} TransactionRequest
 * @typedef {{requestingDapp: string, session: string, targetAccount: string, targetZone: string,
 *   programId: string, programName: string | null, programVersion: string | null,
 *   programAuthor: string | null, asset: Asset | null, amount: number | bigint | null,
 *   destination: string | null, approvalsGranted: ApprovalGrant[], approvalsMoved: AssetMovement[],
 *   unlimitedApproval: boolean, gasEstimate: number | null, gasUsed: number | null,
 *   verificationStatus: VerificationStatus, verificationDetail: string | null,
 *   warnings: string[], rawCalldataHex: string, effectsAvailable: boolean,
 *   actorsDeclared: string[], signersRequired: string[], applies: boolean | null,
 *   feeEstimate: number | bigint | null, toHumanLines?: Function}} EffectsSummary
 */

export const SUBMISSION_ID = 'LP-0021-proclaim-82759d93-58c9-4245-b4bf-6ae8a76d8922';
export const TARGET_ZONE = 'lez-testnet-0.4';
export const CAPABILITIES = Object.freeze([
  'AccountAccess',
  'ReadBalances',
  'ProposeTransaction',
  'GetVerificationStatus',
]);
export const VERIFICATION_BADGES = Object.freeze([
  'Verified',
  'Mismatch',
  'Unregistered',
  'Unavailable',
  'Pending',
]);

/** All 26 field names of the plan §3.3 / wallet-types `EffectsSummary`. */
export const EFFECTS_FIELDS = Object.freeze([
  'requestingDapp', 'session', 'targetAccount', 'targetZone', 'programId',
  'programName', 'programVersion', 'programAuthor', 'asset', 'amount',
  'destination', 'approvalsGranted', 'approvalsMoved', 'unlimitedApproval',
  'gasEstimate', 'gasUsed', 'verificationStatus', 'verificationDetail',
  'warnings', 'rawCalldataHex', 'effectsAvailable', 'actorsDeclared',
  'signersRequired', 'applies', 'feeEstimate', 'toHumanLines',
]);

// ---------------------------------------------------------------------------
// Errors. `ProviderDenied.kind` matches wallet-types `Denied`; `ProviderError.code`
// matches the wallet-core failure families (NOT_APPROVED == InvalidState gate).
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    Object.assign(this, details);
  }
}

export class ProviderDenied extends ProviderError {
  constructor(kind, message, details = {}) {
    super('DENIED', message, { kind, ...details });
    this.name = 'ProviderDenied';
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (mirroring wallet-types).
// ---------------------------------------------------------------------------

/** Hex-encode bytes, a Uint8Array, or an existing 0x-prefixed hex string. */
export function toHex(bytes) {
  if (typeof bytes === 'string') {
    const raw = bytes.startsWith('0x') || bytes.startsWith('0X') ? bytes.slice(2) : bytes;
    if (raw.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(raw)) {
      throw new ProviderError('BAD_REQUEST', 'message must be bytes or even-length hex');
    }
    return raw.toLowerCase();
  }
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  if (!Array.isArray(arr)) {
    throw new ProviderError('BAD_REQUEST', 'message must be bytes or hex');
  }
  if (!arr.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new ProviderError('BAD_REQUEST', 'message bytes must be integers in 0..255');
  }
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `VerificationStatus::badge()` from wallet-types. */
export function verificationBadge(status) {
  switch (status && status.kind) {
    case 'Unregistered': return 'unverified / unknown program';
    case 'RegisteredUnverified': return 'registered, source unverified';
    case 'LocallyVerified': return 'locally source-verified';
    case 'DeployerClaimUnverified': return 'deployer claim unverified';
    case 'Mismatch': return 'source mismatch — high risk';
    default: return 'unverified / unknown program';
  }
}

/** Map a structured verification status + registry failure to the five UI badges. */
export function verificationBadgeForProposal(status, registryErrorKind = null) {
  if (registryErrorKind === 'Unavailable') return 'Unavailable';
  switch (status && status.kind) {
    case 'LocallyVerified': return 'Verified';
    case 'Mismatch': return 'Mismatch';
    case 'RegisteredUnverified':
    case 'DeployerClaimUnverified': return 'Pending';
    case 'Unregistered':
    default: return 'Unregistered';
  }
}

/** `EffectsSummary::to_human_lines()` from wallet-types, in JS. */
export function effectsToHumanLines(effects) {
  const lines = [];
  lines.push(`Requesting dApp: ${effects.requestingDapp}`);
  lines.push(`Account: ${effects.targetAccount} (${effects.targetZone})`);
  const { programName: name, programVersion: version, programAuthor: author } = effects;
  let program;
  if (name && version && author) program = `${name} v${version} by ${author}`;
  else if (name) program = name;
  else program = `unregistered program ${effects.programId}`;
  lines.push(`Program: ${program}`);
  lines.push(`Verification: ${verificationBadge(effects.verificationStatus)}`);
  if (effects.verificationDetail) lines.push(`Verification detail: ${effects.verificationDetail}`);

  if (effects.effectsAvailable) {
    if (effects.asset && effects.amount !== null && effects.amount !== undefined) {
      lines.push(`Asset: ${effects.amount} ${effects.asset.mint} (decimals ${effects.asset.decimals}) on ${effects.asset.programId}`);
    } else if (effects.asset) {
      lines.push(`Asset: ${effects.asset.mint} on ${effects.asset.programId}`);
    } else {
      lines.push('Asset: none declared');
    }
    if (effects.destination) lines.push(`Destination: ${effects.destination}`);
    for (const approval of effects.approvalsGranted) {
      if (approval.unlimited) {
        lines.push(`UNLIMITED APPROVAL: ${approval.spender} may spend any amount of ${approval.mint} (owner ${approval.owner})`);
      } else {
        lines.push(`Approval: ${approval.spender} may spend ${JSON.stringify(approval.amount)} of ${approval.mint} (owner ${approval.owner})`);
      }
    }
    for (const movement of effects.approvalsMoved) {
      lines.push(`Transfer: ${movement.amount} ${movement.mint} from ${movement.from} to ${movement.to} via ${movement.program_id ?? movement.programId}`);
    }
    if (effects.gasEstimate !== null && effects.gasEstimate !== undefined) lines.push(`Estimated cycles: ${effects.gasEstimate}`);
    if (effects.gasUsed !== null && effects.gasUsed !== undefined) lines.push(`Cycles used (simulated): ${effects.gasUsed}`);
    if (effects.feeEstimate !== null && effects.feeEstimate !== undefined) lines.push(`Estimated fee: ${effects.feeEstimate}`);
    if (effects.actorsDeclared.length) lines.push(`Declared actors: ${JSON.stringify(effects.actorsDeclared)}`);
    if (effects.signersRequired.length) lines.push(`Signers required: ${JSON.stringify(effects.signersRequired)}`);
    if (effects.applies !== null && effects.applies !== undefined) {
      lines.push(`Simulation: ${effects.applies ? 'applies' : 'reverts'}`);
    }
  } else {
    lines.push('Cannot render effects — IDL unavailable; raw calldata only');
  }
  for (const warning of effects.warnings) lines.push(`WARNING: ${warning}`);
  lines.push(`Raw calldata: 0x${effects.rawCalldataHex}`);
  return lines;
}

function decorateEffects(effects) {
  Object.defineProperty(effects, 'toHumanLines', {
    value: () => effectsToHumanLines(effects),
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return effects;
}

function cloneJson(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** Copy an EffectsSummary and re-attach its non-enumerable `toHumanLines()`. */
export function cloneEffects(effects) {
  return decorateEffects(cloneJson(effects));
}

function freshArray(value) {
  return Array.isArray(value) ? [...value] : [];
}

// ---------------------------------------------------------------------------
// Dependency-free in-memory fixtures mirroring the Rust wallet-core test data.
// ---------------------------------------------------------------------------

export function defaultAccounts() {
  return [
    { id: 'alice', kind: 'Public', label: 'Alice (public)', zone: TARGET_ZONE },
    { id: 'bob', kind: 'Shielded', label: 'Bob (shielded)', zone: TARGET_ZONE },
  ];
}

export function sampleTransactionRequest(overrides = {}) {
  return {
    dappId: 'testimonial-app',
    session: 'session-1',
    programId: 'testimonial-store',
    message: [0xca, 0xfe, 0xba, 0xbe],
    declaredActors: [],
    feePayer: 'alice',
    value: null,
    ...overrides,
  };
}

export function sampleProgramMeta(overrides = {}) {
  return {
    programId: 'testimonial-store',
    name: 'testimonial_store',
    version: '0.1.0',
    author: 'logos',
    description: 'stores testimonials',
    idlPointer: 'idl://testimonial_store',
    codePointer: 'git+https://example.invalid/testimonial#abc123',
    registeredAt: '2026-11-19',
    deployerSigned: true,
    ...overrides,
  };
}

export function sampleVerificationStatus() {
  return { kind: 'LocallyVerified', sourceCommit: 'abc123', imageId: 'image-abc123' };
}

/** `SimulationResult::ok()` with the rich unlimited-approval fixture from wallet-core. */
export function sampleSimulationResult(overrides = {}) {
  const base = {
    effectsAvailable: true,
    asset: { programId: 'token-program', mint: 'mint-lp', amount: 500, decimals: 6 },
    destination: 'bob',
    approvalsGranted: [{
      owner: 'alice',
      spender: 'token-program',
      mint: 'mint-lp',
      amount: null,
      unlimited: true,
    }],
    approvalsMoved: [{
      from: 'alice', to: 'bob', programId: 'token-program', mint: 'mint-lp', amount: 500,
    }],
    unlimitedApproval: true,
    gasEstimate: 123,
    gasUsed: 120,
    actorsDeclared: [],
    signersRequired: ['alice'],
    applies: true,
    feeEstimate: 7,
    notes: [],
  };
  return cloneJson({ ...base, ...overrides });
}

/** `SimulationResult::degraded()` — never asserts that unknown effects are safe. */
export function emptySimulationResult() {
  return {
    effectsAvailable: false,
    asset: null,
    destination: null,
    approvalsGranted: [],
    approvalsMoved: [],
    unlimitedApproval: false,
    gasEstimate: null,
    gasUsed: null,
    actorsDeclared: [],
    signersRequired: [],
    applies: null,
    feeEstimate: null,
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// Adapter mocks. Class names mirror the Rust traits; `Mock*` are the exported
// in-memory implementations. No adapter performs I/O.
// ---------------------------------------------------------------------------

/** `FundingProvider` mock: PR #181 swappable funding boundary. */
export class MockFundingProvider {
  constructor(options = [{ id: 'faucet', label: 'LEZ testnet faucet (mock)' }]) {
    this.options = cloneJson(options);
    this.optionCalls = 0;
    this.requests = [];
  }

  getFundingOptions(_context = {}) {
    this.optionCalls += 1;
    return cloneJson(this.options);
  }

  requestFunding({ account = null, optionId = null, amount = null } = {}) {
    this.requests.push({ account, optionId, amount });
    return {
      accepted: true,
      receiptId: `funding-${this.requests.length}`,
      account,
      amount,
    };
  }

  logSnapshot() {
    return { optionCalls: this.optionCalls, requests: [...this.requests] };
  }
}

/** `ProgramRegistry` mock (LP-0023 boundary). */
export class MockProgramRegistry {
  constructor() {
    this.programs = new Map();
    this.failure = null;
    this.resolveCalls = [];
    this.statusCalls = [];
  }

  withProgram(meta, status = { kind: 'RegisteredUnverified' }) {
    this.programs.set(meta.programId, { meta: cloneJson(meta), status: cloneJson(status) });
    return this;
  }

  failing(kind = 'Unavailable') {
    this.failure = kind;
    return this;
  }

  resolve(programId) {
    this.resolveCalls.push(programId);
    if (this.failure) {
      const message = this.failure === 'Unavailable' ? 'mock registry offline' : 'mock registry error';
      const err = new ProviderError(this.failure, message);
      err.kind = this.failure;
      throw err;
    }
    const entry = this.programs.get(programId);
    if (!entry) {
      const err = new ProviderError('NotFound', `program not found: ${programId}`);
      err.kind = 'NotFound';
      throw err;
    }
    return cloneJson(entry.meta);
  }

  verificationStatus(programId) {
    this.statusCalls.push(programId);
    const entry = this.programs.get(programId);
    return entry ? cloneJson(entry.status) : { kind: 'Unregistered' };
  }

  logSnapshot() {
    return { resolveCalls: this.resolveCalls.length, statusCalls: this.statusCalls.length };
  }
}

/** `IdlProvider` mock (PR #188 `lez-idl` decode + simulate boundary). */
export class MockIdlProvider {
  constructor() {
    this.results = new Map();
    this.failure = null;
    this.calls = [];
  }

  withResult(programId, result) {
    this.results.set(programId, cloneJson(result));
    return this;
  }

  failing(kind = 'Unavailable') {
    this.failure = kind;
    return this;
  }

  decodeAndSimulate({ request, _meta = null } = {}) {
    this.calls.push(request ? request.programId : null);
    if (this.failure) {
      const err = new ProviderError(this.failure, `mock IDL ${this.failure.toLowerCase()}`);
      err.kind = this.failure;
      throw err;
    }
    const result = this.results.get(request ? request.programId : null);
    if (!result) {
      const err = new ProviderError('Unavailable', `mock IDL unavailable: ${request ? request.programId : 'unknown'}`);
      err.kind = 'Unavailable';
      throw err;
    }
    return cloneJson(result);
  }

  logSnapshot() {
    return { calls: this.calls.length };
  }
}

/** `CoreAuthorizer` mock. No grants == deny-all, exactly like `MockAuthorizer` in Rust. */
export class MockCoreAuthorizer {
  constructor() {
    this.grants = new Set();
    this.log = { calls: 0, grantsUsed: 0 };
  }

  static _key(session, account) {
    return `${session}\u0000${account}`;
  }

  grant(session, account) {
    this.grants.add(MockCoreAuthorizer._key(session, account));
    return this;
  }

  denyAll() {
    this.grants.clear();
    return this;
  }

  approve({ session, account, _effects = null } = {}) {
    this.log.calls += 1;
    if (!this.grants.has(MockCoreAuthorizer._key(session, account))) {
      throw new ProviderDenied('UserRejected', 'user did not grant this session/account');
    }
    this.log.grantsUsed += 1;
    return `token-${this.log.calls}`;
  }

  logSnapshot() {
    return { ...this.log };
  }
}

/** `Signer` mock: records calls; optional submit failure for the Failed state. */
export class MockSigner {
  constructor() {
    this.log = { signCalls: 0, submitCalls: 0 };
    this.failSubmit = false;
  }

  failingSubmit() {
    this.failSubmit = true;
    return this;
  }

  sign({ requestId, request, _effects = null, token } = {}) {
    this.log.signCalls += 1;
    const sigText = `mock-signature-for-${token}`;
    return {
      requestId,
      account: request.feePayer,
      signature: Array.from(sigText, (ch) => ch.charCodeAt(0)),
      txBytes: freshArray(request.message),
    };
  }

  submit(tx) {
    this.log.submitCalls += 1;
    if (this.failSubmit) throw new ProviderError('SIGNER', 'mock submit failure');
    return { requestId: tx.requestId, accepted: true, signatureHex: toHex(tx.signature) };
  }

  logSnapshot() {
    return { ...this.log };
  }
}

// ---------------------------------------------------------------------------
// Effects preview builder — mirrors `wallet-core::build_effects`.
// ---------------------------------------------------------------------------

function normalizeSimulation(sim) {
  const base = emptySimulationResult();
  const merged = { ...base, ...(sim || {}) };
  merged.approvalsGranted = freshArray(merged.approvalsGranted);
  merged.approvalsMoved = freshArray(merged.approvalsMoved);
  merged.actorsDeclared = freshArray(merged.actorsDeclared);
  merged.signersRequired = freshArray(merged.signersRequired);
  merged.notes = freshArray(merged.notes);
  return merged;
}

function buildEffects(request, meta, verificationStatus, sim, warnings) {
  if (sim.unlimitedApproval && !warnings.some((w) => w.includes('unlimited'))) {
    warnings.push('transaction grants an UNLIMITED token approval');
  }
  if (sim.applies === false) warnings.push('simulation indicates the call will revert');

  const asset = sim.asset || request.value || null;
  const effects = {
    requestingDapp: request.dappId,
    session: request.session,
    targetAccount: request.feePayer,
    targetZone: TARGET_ZONE,
    programId: request.programId,
    programName: meta ? meta.name : null,
    programVersion: meta ? meta.version : null,
    programAuthor: meta ? meta.author : null,
    asset,
    amount: asset ? asset.amount : null,
    destination: sim.destination,
    approvalsGranted: sim.approvalsGranted,
    approvalsMoved: sim.approvalsMoved,
    unlimitedApproval: sim.unlimitedApproval,
    gasEstimate: sim.gasEstimate,
    gasUsed: sim.gasUsed,
    verificationStatus,
    verificationDetail: meta && meta.codePointer ? meta.codePointer : null,
    warnings: [...warnings],
    rawCalldataHex: toHex(request.message),
    effectsAvailable: sim.effectsAvailable,
    actorsDeclared: sim.effectsAvailable ? sim.actorsDeclared : freshArray(request.declaredActors),
    signersRequired: sim.signersRequired,
    applies: sim.applies,
    feeEstimate: sim.feeEstimate,
  };
  return decorateEffects(effects);
}

function normalizeRequest(input) {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('BAD_REQUEST', 'transaction request must be an object');
  }
  for (const field of ['dappId', 'session', 'programId', 'feePayer']) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new ProviderError('BAD_REQUEST', `transaction request needs a non-empty ${field}`);
    }
  }
  if (input.message === undefined || input.message === null) {
    throw new ProviderError('BAD_REQUEST', 'transaction request needs message bytes');
  }
  // Always store plain bytes: a Uint8Array or hex string must not survive as a
  // JSON-cloned object and reach the Signer in a broken shape.
  let message;
  if (typeof input.message === 'string') {
    const hex = toHex(input.message);
    message = [];
    for (let i = 0; i < hex.length; i += 2) message.push(parseInt(hex.slice(i, i + 2), 16));
  } else {
    message = freshArray(input.message instanceof Uint8Array ? Array.from(input.message) : input.message);
  }
  toHex(message); // validate now; a bad message must not reach the Signer later
  return {
    dappId: input.dappId,
    session: input.session,
    programId: input.programId,
    message,
    declaredActors: freshArray(input.declaredActors),
    feePayer: input.feePayer,
    value: input.value || null,
  };
}

const STATE_NAMES = Object.freeze({
  awaiting_approval: 'AwaitingApproval',
  approved: 'Approved',
  rejected: 'Rejected',
  signed: 'Signed',
  submitted: 'Submitted',
  failed: 'Failed',
});

// ---------------------------------------------------------------------------
// The provider surface a third-party dApp uses.
// ---------------------------------------------------------------------------

export class ProclaimWalletProvider {
  /**
   * Adapter keys are capitalised to match the Rust trait names in
   * wallet-core. Omitted adapters default to the in-memory mocks above.
   */
  constructor({
    FundingProvider = new MockFundingProvider(),
    ProgramRegistry = new MockProgramRegistry(),
    IdlProvider = new MockIdlProvider(),
    CoreAuthorizer = new MockCoreAuthorizer(),
    Signer = new MockSigner(),
    accounts = defaultAccounts(),
  } = {}) {
    this.FundingProvider = FundingProvider;
    this.ProgramRegistry = ProgramRegistry;
    this.IdlProvider = IdlProvider;
    this.CoreAuthorizer = CoreAuthorizer;
    this.Signer = Signer;
    this.accounts = cloneJson(accounts);
    this.selectedAccountId = null;
    this.proposals = new Map();
    this.nextRequest = 0;
  }

  getCapabilities() {
    return {
      protocol: 'LP-0021-wallet-provider/phase0',
      submissionId: SUBMISSION_ID,
      capabilities: [...CAPABILITIES],
      accounts: {
        list: true,
        select: true,
        kinds: ['Public', 'Shielded'],
      },
      signTransaction: {
        propose: true,
        authorize: true,
        reject: true,
        signAndSubmit: true,
        approvalInvariant: 'no signing without explicit authorize()',
      },
      registryResolution: {
        resolve: true,
        verificationStatus: true,
        badges: [...VERIFICATION_BADGES],
      },
      idlPreview: {
        decodeAndSimulate: true,
        humanReadableEffects: true,
        rawCalldataFallback: true,
      },
      funding: { available: true, adapter: 'FundingProvider' },
    };
  }

  listAccounts() {
    return this.accounts.map((account) => ({ ...account }));
  }

  selectAccount(id) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new ProviderError('UNKNOWN_ACCOUNT', `unknown account: ${id}`);
    this.selectedAccountId = id;
    return { ...account };
  }

  getFundingOptions(accountId = this.selectedAccountId) {
    return this.FundingProvider.getFundingOptions({ account: accountId });
  }

  requestFunding(options = {}) {
    const account = options.account ?? this.selectedAccountId;
    return this.FundingProvider.requestFunding({ ...options, account });
  }

  /** `wallet_proposeTransaction`: resolve, simulate, preview, then wait. */
  proposeTransaction(input) {
    const request = normalizeRequest(input);
    const warnings = [];
    const normalizedStatus = { kind: 'Unregistered' };
    let meta = null;
    let verificationStatus = normalizedStatus;
    let registryErrorKind = null;

    try {
      meta = this.ProgramRegistry.resolve(request.programId);
      verificationStatus = cloneJson(
        this.ProgramRegistry.verificationStatus(request.programId) || normalizedStatus,
      );
    } catch (err) {
      registryErrorKind = err && err.kind ? err.kind : 'Unavailable';
      const message = err && err.message ? err.message : String(err);
      warnings.push(
        `registry lookup failed (${registryErrorKind}: ${message}): showing unverified / unknown program`,
      );
      verificationStatus = { kind: 'Unregistered' };
    }

    if (verificationStatus.kind === 'Mismatch') {
      warnings.push('program source image does not match the deployed program');
    } else if (verificationStatus.kind === 'DeployerClaimUnverified') {
      warnings.push('deployer source claim has not been independently verified');
    }

    let sim;
    try {
      sim = normalizeSimulation(
        this.IdlProvider.decodeAndSimulate({ request: cloneJson(request), meta }),
      );
      warnings.push(...sim.notes);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      warnings.push(`cannot render effects — IDL unavailable: ${message}`);
      sim = emptySimulationResult();
    }

    const effects = buildEffects(request, meta, verificationStatus, sim, warnings);
    this.nextRequest += 1;
    const id = `req-${this.nextRequest}`;
    const record = {
      id,
      request,
      effects,
      verification: verificationBadgeForProposal(verificationStatus, registryErrorKind),
      verificationStatus: cloneJson(verificationStatus),
      state: 'awaiting_approval',
      token: null,
      tx: null,
      receipt: null,
    };
    this.proposals.set(id, record);
    return this.snapshotProposal(record);
  }

  /** `wallet_getEffectsPreview`: a fresh copy, never the internal preview. */
  effectsPreview(proposalId) {
    const record = this._record(proposalId);
    if (!['awaiting_approval', 'approved', 'signed'].includes(record.state)) {
      throw new ProviderError('INVALID_STATE', `no effects in state ${record.state}`);
    }
    return cloneEffects(record.effects);
  }

  getEffectsPreview(proposalId) {
    return this.effectsPreview(proposalId);
  }

  getProposal(proposalId) {
    return this.snapshotProposal(this._record(proposalId));
  }

  stateOf(proposalId) {
    return this._record(proposalId).state;
  }

  /** Only `awaiting_approval` -> `approved`; every other state is denied. */
  authorize(proposalId, context = {}) {
    const record = this._record(proposalId);
    const capability = context.capability ?? 'ProposeTransaction';
    if (capability !== 'ProposeTransaction') {
      throw new ProviderDenied('CapabilityNotGranted', `capability not granted: ${capability}`, { capability });
    }
    if (record.state !== 'awaiting_approval') {
      throw new ProviderDenied('InvalidState', `expected AwaitingApproval, got ${STATE_NAMES[record.state] || record.state}`);
    }

    const session = context.session ?? record.request.session;
    const account = context.account ?? this.selectedAccountId ?? record.request.feePayer;
    if (account !== record.request.feePayer) {
      throw new ProviderDenied('AccountMismatch', `account ${account} is not the fee payer ${record.request.feePayer}`);
    }
    if (this.selectedAccountId && account !== this.selectedAccountId) {
      throw new ProviderDenied('AccountMismatch', `selected account is ${this.selectedAccountId}, not ${account}`);
    }
    if (!this.accounts.some((a) => a.id === account)) {
      throw new ProviderDenied('AccountMismatch', `unknown account: ${account}`);
    }
    if (session !== record.request.session) {
      throw new ProviderDenied('NoSession', `no session ${session} for this request`);
    }

    let token;
    try {
      token = this.CoreAuthorizer.approve({
        session,
        account,
        effects: cloneEffects(record.effects),
      });
    } catch (err) {
      if (err instanceof ProviderDenied) throw err;
      throw new ProviderDenied(
        'Policy',
        `core authorizer refused: ${err && err.message ? err.message : String(err)}`,
      );
    }
    if (!token) throw new ProviderDenied('Policy', 'core authorizer returned no approval token');

    record.state = 'approved';
    record.token = token;
    return token;
  }

  /** `awaiting_approval` -> `rejected`; a rejected request can never be signed. */
  reject(proposalId, reason = null) {
    const record = this._record(proposalId);
    if (record.state !== 'awaiting_approval') {
      throw new ProviderError('INVALID_STATE', `expected AwaitingApproval, got ${STATE_NAMES[record.state] || record.state}`);
    }
    record.state = 'rejected';
    record.reason = reason;
    return this.snapshotProposal(record);
  }

  /** Refuses everything except `approved`, before touching the Signer. */
  signAndSubmit(proposalId) {
    const record = this._record(proposalId);
    if (record.state !== 'approved') {
      throw new ProviderError(
        'NOT_APPROVED',
        `expected Approved, got ${STATE_NAMES[record.state] || record.state}`,
        { requestId: proposalId, expected: 'Approved', actual: record.state },
      );
    }

    let tx;
    try {
      tx = this.Signer.sign({
        requestId: proposalId,
        request: cloneJson(record.request),
        effects: cloneEffects(record.effects),
        token: record.token,
      });
    } catch (err) {
      record.state = 'failed';
      throw err;
    }
    record.state = 'signed';
    record.tx = tx;

    let receipt;
    try {
      receipt = this.Signer.submit(tx);
    } catch (err) {
      record.state = 'failed';
      throw err;
    }
    record.state = 'submitted';
    record.receipt = receipt;
    return cloneJson(receipt);
  }

  _record(proposalId) {
    const record = this.proposals.get(proposalId);
    if (!record) throw new ProviderError('UNKNOWN_REQUEST', `unknown request: ${proposalId}`);
    return record;
  }

  snapshotProposal(record) {
    return {
      id: record.id,
      state: record.state,
      stateName: STATE_NAMES[record.state] || record.state,
      request: cloneJson(record.request),
      effects: cloneEffects(record.effects),
      verification: record.verification,
      verificationStatus: cloneJson(record.verificationStatus),
      warnings: [...record.effects.warnings],
      reason: record.reason ?? null,
      token: record.token,
      tx: record.tx ? cloneJson(record.tx) : null,
      receipt: record.receipt ? cloneJson(record.receipt) : null,
    };
  }
}

export default ProclaimWalletProvider;
