// SPDX-License-Identifier: MIT AND Apache-2.0
// LP-0021 dependency-free Wallet Provider client (Phase 0 provider surface).
//
// Typed TypeScript mirror of provider.js. The tests run provider.js directly
// (zero build step). Keep the two files in sync when changing the API.
import { denyTransport } from './transport.js';
import type { Transport } from './transport.js';

export type AccountKind = 'Public' | 'Shielded';
export type Capability =
  | 'AccountAccess'
  | 'ReadBalances'
  | 'ProposeTransaction'
  | 'GetVerificationStatus';
export type VerificationBadge =
  | 'Verified'
  | 'Mismatch'
  | 'Unregistered'
  | 'Unavailable'
  | 'Pending';
export type ProposalState =
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'signed'
  | 'submitted'
  | 'failed';

export interface AccountRef {
  id: string;
  kind: AccountKind;
  label: string;
  zone: string;
}

export type VerificationStatus =
  | { kind: 'Unregistered' }
  | { kind: 'RegisteredUnverified' }
  | { kind: 'LocallyVerified'; sourceCommit: string; imageId: string }
  | { kind: 'DeployerClaimUnverified' }
  | { kind: 'Mismatch' };

export interface ProgramMeta {
  programId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  idlPointer: string | null;
  codePointer: string | null;
  registeredAt: string | null;
  deployerSigned: boolean;
}

export interface Asset {
  programId?: string;
  mint: string;
  amount: number | bigint;
  decimals: number;
}

export interface ApprovalGrant {
  owner: string;
  spender: string;
  mint: string;
  amount: number | bigint | null;
  unlimited: boolean;
}

export interface AssetMovement {
  from: string;
  to: string;
  programId: string;
  mint: string;
  amount: number | bigint;
}

export interface SimulationResult {
  effectsAvailable: boolean;
  asset: Asset | null;
  destination: string | null;
  approvalsGranted: ApprovalGrant[];
  approvalsMoved: AssetMovement[];
  unlimitedApproval: boolean;
  gasEstimate: number | null;
  gasUsed: number | null;
  actorsDeclared: string[];
  signersRequired: string[];
  applies: boolean | null;
  feeEstimate: number | bigint | null;
  notes: string[];
}

export interface TransactionRequest {
  dappId: string;
  session: string;
  programId: string;
  message: number[] | Uint8Array | string;
  declaredActors: string[];
  feePayer: string;
  value: Asset | null;
}

/** All 26 fields of plan §3.3 / wallet-types `EffectsSummary`. */
export interface EffectsSummary {
  requestingDapp: string;
  session: string;
  targetAccount: string;
  targetZone: string;
  programId: string;
  programName: string | null;
  programVersion: string | null;
  programAuthor: string | null;
  asset: Asset | null;
  amount: number | bigint | null;
  destination: string | null;
  approvalsGranted: ApprovalGrant[];
  approvalsMoved: AssetMovement[];
  unlimitedApproval: boolean;
  gasEstimate: number | null;
  gasUsed: number | null;
  verificationStatus: VerificationStatus;
  verificationDetail: string | null;
  warnings: string[];
  rawCalldataHex: string;
  effectsAvailable: boolean;
  actorsDeclared: string[];
  signersRequired: string[];
  applies: boolean | null;
  feeEstimate: number | bigint | null;
  toHumanLines(): string[];
}

export interface SignedTransaction {
  requestId: string;
  account: string;
  signature: number[];
  txBytes: number[];
}

export interface SubmissionReceipt {
  requestId: string;
  accepted: boolean;
  signatureHex: string;
}

export interface ProposalSnapshot {
  id: string;
  state: ProposalState;
  stateName: string;
  request: TransactionRequest;
  effects: EffectsSummary;
  verification: VerificationBadge;
  verificationStatus: VerificationStatus;
  warnings: string[];
  reason: string | null;
  token: string | null;
  tx: SignedTransaction | null;
  receipt: SubmissionReceipt | null;
}

export interface AuthorizeContext {
  capability?: Capability;
  session?: string;
  account?: string;
}

export interface FundingOption {
  id: string;
  label: string;
}

interface ProposalRecord {
  id: string;
  request: TransactionRequest;
  effects: EffectsSummary;
  verification: VerificationBadge;
  verificationStatus: VerificationStatus;
  state: ProposalState;
  token: string | null;
  tx: SignedTransaction | null;
  receipt: SubmissionReceipt | null;
  reason?: string | null;
}

export const SUBMISSION_ID = 'LP-0021-proclaim-82759d93-58c9-4245-b4bf-6ae8a76d8922';
export const TARGET_ZONE = 'lez-testnet-0.4';
export const CAPABILITIES: readonly Capability[] = Object.freeze([
  'AccountAccess',
  'ReadBalances',
  'ProposeTransaction',
  'GetVerificationStatus',
]);
export const VERIFICATION_BADGES: readonly VerificationBadge[] = Object.freeze([
  'Verified',
  'Mismatch',
  'Unregistered',
  'Unavailable',
  'Pending',
]);
export const EFFECTS_FIELDS: readonly string[] = Object.freeze([
  'requestingDapp', 'session', 'targetAccount', 'targetZone', 'programId',
  'programName', 'programVersion', 'programAuthor', 'asset', 'amount',
  'destination', 'approvalsGranted', 'approvalsMoved', 'unlimitedApproval',
  'gasEstimate', 'gasUsed', 'verificationStatus', 'verificationDetail',
  'warnings', 'rawCalldataHex', 'effectsAvailable', 'actorsDeclared',
  'signersRequired', 'applies', 'feeEstimate', 'toHumanLines',
]);

// Errors: ProviderDenied.kind matches wallet-types `Denied`; ProviderError.code
// matches the wallet-core failure families (NOT_APPROVED == the sign gate).
export class ProviderError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
    Object.assign(this, details);
  }
}

export class ProviderDenied extends ProviderError {
  readonly kind: string;

  constructor(kind: string, message: string, details: Record<string, unknown> = {}) {
    super('DENIED', message, { kind, ...details });
    this.name = 'ProviderDenied';
    this.kind = kind;
  }
}

export function toHex(bytes: number[] | Uint8Array | string): string {
  if (typeof bytes === 'string') {
    const raw = bytes.startsWith('0x') || bytes.startsWith('0X') ? bytes.slice(2) : bytes;
    if (raw.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(raw)) {
      throw new ProviderError('BAD_REQUEST', 'message must be bytes or even-length hex');
    }
    return raw.toLowerCase();
  }
  const arr: number[] = bytes instanceof Uint8Array ? Array.from(bytes) : bytes;
  if (!arr.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new ProviderError('BAD_REQUEST', 'message bytes must be integers in 0..255');
  }
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `VerificationStatus::badge()` from wallet-types. */
export function verificationBadge(status: VerificationStatus | null | undefined): string {
  switch (status && status.kind) {
    case 'Unregistered': return 'unverified / unknown program';
    case 'RegisteredUnverified': return 'registered, source unverified';
    case 'LocallyVerified': return 'locally source-verified';
    case 'DeployerClaimUnverified': return 'deployer claim unverified';
    case 'Mismatch': return 'source mismatch — high risk';
    default: return 'unverified / unknown program';
  }
}

export function verificationBadgeForProposal(
  status: VerificationStatus,
  registryErrorKind: string | null = null,
): VerificationBadge {
  if (registryErrorKind === 'Unavailable') return 'Unavailable';
  switch (status.kind) {
    case 'LocallyVerified': return 'Verified';
    case 'Mismatch': return 'Mismatch';
    case 'RegisteredUnverified':
    case 'DeployerClaimUnverified': return 'Pending';
    case 'Unregistered':
    default: return 'Unregistered';
  }
}

/** `EffectsSummary::to_human_lines()` from wallet-types, in TypeScript. */
export function effectsToHumanLines(effects: EffectsSummary): string[] {
  const lines: string[] = [];
  lines.push(`Requesting dApp: ${effects.requestingDapp}`);
  lines.push(`Account: ${effects.targetAccount} (${effects.targetZone})`);
  const { programName: name, programVersion: version, programAuthor: author } = effects;
  let program: string;
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
      lines.push(`Transfer: ${movement.amount} ${movement.mint} from ${movement.from} to ${movement.to} via ${movement.programId}`);
    }
    if (effects.gasEstimate !== null) lines.push(`Estimated cycles: ${effects.gasEstimate}`);
    if (effects.gasUsed !== null) lines.push(`Cycles used (simulated): ${effects.gasUsed}`);
    if (effects.feeEstimate !== null) lines.push(`Estimated fee: ${effects.feeEstimate}`);
    if (effects.actorsDeclared.length) lines.push(`Declared actors: ${JSON.stringify(effects.actorsDeclared)}`);
    if (effects.signersRequired.length) lines.push(`Signers required: ${JSON.stringify(effects.signersRequired)}`);
    if (effects.applies !== null) lines.push(`Simulation: ${effects.applies ? 'applies' : 'reverts'}`);
  } else {
    lines.push('Cannot render effects — IDL unavailable; raw calldata only');
  }
  for (const warning of effects.warnings) lines.push(`WARNING: ${warning}`);
  lines.push(`Raw calldata: 0x${effects.rawCalldataHex}`);
  return lines;
}

function decorateEffects(effects: EffectsSummary): EffectsSummary {
  Object.defineProperty(effects, 'toHumanLines', {
    value: () => effectsToHumanLines(effects),
    enumerable: false,
    configurable: true,
    writable: false,
  });
  return effects;
}

function cloneJson<T>(value: T): T {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value)) as T;
}

export function cloneEffects(effects: EffectsSummary): EffectsSummary {
  return decorateEffects(cloneJson(effects));
}

function freshArray<T>(value: T[] | Uint8Array | null | undefined): T[] {
  return Array.isArray(value) ? [...value] : [];
}

// Dependency-free fixtures mirroring the Rust wallet-core test data.
export function defaultAccounts(): AccountRef[] {
  return [
    { id: 'alice', kind: 'Public', label: 'Alice (public)', zone: TARGET_ZONE },
    { id: 'bob', kind: 'Shielded', label: 'Bob (shielded)', zone: TARGET_ZONE },
  ];
}

export function sampleTransactionRequest(overrides: Partial<TransactionRequest> = {}): TransactionRequest {
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

export function sampleProgramMeta(overrides: Partial<ProgramMeta> = {}): ProgramMeta {
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

export function sampleVerificationStatus(): VerificationStatus {
  return { kind: 'LocallyVerified', sourceCommit: 'abc123', imageId: 'image-abc123' };
}

export function sampleSimulationResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  const base: SimulationResult = {
    effectsAvailable: true,
    asset: { programId: 'token-program', mint: 'mint-lp', amount: 500, decimals: 6 },
    destination: 'bob',
    approvalsGranted: [{
      owner: 'alice', spender: 'token-program', mint: 'mint-lp', amount: null, unlimited: true,
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

export function emptySimulationResult(): SimulationResult {
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

// Adapter mocks. Class names match the Rust traits; `Mock*` are the in-memory
// implementations. No adapter performs I/O.
export class MockFundingProvider {
  options: FundingOption[];
  optionCalls = 0;
  requests: Array<{ account: string | null; optionId: string | null; amount: number | bigint | null }> = [];

  constructor(options: FundingOption[] = [{ id: 'faucet', label: 'LEZ testnet faucet (mock)' }]) {
    this.options = cloneJson(options);
  }

  getFundingOptions(_context: { account?: string | null } = {}): FundingOption[] {
    this.optionCalls += 1;
    return cloneJson(this.options);
  }

  requestFunding(
    { account = null, optionId = null, amount = null }:
      { account?: string | null; optionId?: string | null; amount?: number | bigint | null } = {},
  ): { accepted: boolean; receiptId: string; account: string | null; amount: number | bigint | null } {
    this.requests.push({ account, optionId, amount });
    return { accepted: true, receiptId: `funding-${this.requests.length}`, account, amount };
  }

  logSnapshot(): { optionCalls: number; requests: typeof this.requests } {
    return { optionCalls: this.optionCalls, requests: [...this.requests] };
  }
}

export class MockProgramRegistry {
  programs = new Map<string, { meta: ProgramMeta; status: VerificationStatus }>();
  failure: string | null = null;
  resolveCalls: string[] = [];
  statusCalls: string[] = [];

  withProgram(meta: ProgramMeta, status: VerificationStatus = { kind: 'RegisteredUnverified' }): this {
    this.programs.set(meta.programId, { meta: cloneJson(meta), status: cloneJson(status) });
    return this;
  }

  failing(kind = 'Unavailable'): this {
    this.failure = kind;
    return this;
  }

  resolve(programId: string): ProgramMeta {
    this.resolveCalls.push(programId);
    if (this.failure) {
      const message = this.failure === 'Unavailable' ? 'mock registry offline' : 'mock registry error';
      const err = new ProviderError(this.failure, message);
      Object.assign(err, { kind: this.failure });
      throw err;
    }
    const entry = this.programs.get(programId);
    if (!entry) {
      const err = new ProviderError('NotFound', `program not found: ${programId}`);
      Object.assign(err, { kind: 'NotFound' });
      throw err;
    }
    return cloneJson(entry.meta);
  }

  verificationStatus(programId: string): VerificationStatus {
    this.statusCalls.push(programId);
    const entry = this.programs.get(programId);
    return entry ? cloneJson(entry.status) : { kind: 'Unregistered' };
  }

  logSnapshot(): { resolveCalls: number; statusCalls: number } {
    return { resolveCalls: this.resolveCalls.length, statusCalls: this.statusCalls.length };
  }
}

export class MockIdlProvider {
  results = new Map<string, SimulationResult>();
  failure: string | null = null;
  calls: Array<string | null> = [];

  withResult(programId: string, result: SimulationResult): this {
    this.results.set(programId, cloneJson(result));
    return this;
  }

  failing(kind = 'Unavailable'): this {
    this.failure = kind;
    return this;
  }

  decodeAndSimulate({ request, _meta = null }: { request: TransactionRequest; _meta?: ProgramMeta | null }): SimulationResult {
    this.calls.push(request ? request.programId : null);
    if (this.failure) {
      const err = new ProviderError(this.failure, `mock IDL ${this.failure.toLowerCase()}`);
      Object.assign(err, { kind: this.failure });
      throw err;
    }
    const result = this.results.get(request ? request.programId : '');
    if (!result) {
      const err = new ProviderError('Unavailable', `mock IDL unavailable: ${request ? request.programId : 'unknown'}`);
      Object.assign(err, { kind: 'Unavailable' });
      throw err;
    }
    return cloneJson(result);
  }

  logSnapshot(): { calls: number } {
    return { calls: this.calls.length };
  }
}

export class MockCoreAuthorizer {
  grants = new Set<string>();
  log = { calls: 0, grantsUsed: 0 };

  private static key(session: string, account: string): string {
    return `${session}\u0000${account}`;
  }

  grant(session: string, account: string): this {
    this.grants.add(MockCoreAuthorizer.key(session, account));
    return this;
  }

  denyAll(): this {
    this.grants.clear();
    return this;
  }

  approve({ session, account, _effects = null }: { session: string; account: string; _effects?: EffectsSummary | null }): string {
    this.log.calls += 1;
    if (!this.grants.has(MockCoreAuthorizer.key(session, account))) {
      throw new ProviderDenied('UserRejected', 'user did not grant this session/account');
    }
    this.log.grantsUsed += 1;
    return `token-${this.log.calls}`;
  }

  logSnapshot(): { calls: number; grantsUsed: number } {
    return { ...this.log };
  }
}

export class MockSigner {
  log = { signCalls: 0, submitCalls: 0 };
  failSubmit = false;

  failingSubmit(): this {
    this.failSubmit = true;
    return this;
  }

  sign(
    { requestId, request, _effects = null, token }:
      { requestId: string; request: TransactionRequest; _effects?: EffectsSummary | null; token: string },
  ): SignedTransaction {
    this.log.signCalls += 1;
    const sigText = `mock-signature-for-${token}`;
    return {
      requestId,
      account: request.feePayer,
      signature: Array.from(sigText, (ch) => ch.charCodeAt(0)),
      txBytes: freshArray<number>(request.message),
    };
  }

  submit(tx: SignedTransaction): SubmissionReceipt {
    this.log.submitCalls += 1;
    if (this.failSubmit) throw new ProviderError('SIGNER', 'mock submit failure');
    return { requestId: tx.requestId, accepted: true, signatureHex: toHex(tx.signature) };
  }

  logSnapshot(): { signCalls: number; submitCalls: number } {
    return { ...this.log };
  }
}

function normalizeSimulation(sim: SimulationResult | null | undefined): SimulationResult {
  const base = emptySimulationResult();
  const merged: SimulationResult = { ...base, ...(sim || {}) };
  merged.approvalsGranted = freshArray(merged.approvalsGranted);
  merged.approvalsMoved = freshArray(merged.approvalsMoved);
  merged.actorsDeclared = freshArray(merged.actorsDeclared);
  merged.signersRequired = freshArray(merged.signersRequired);
  merged.notes = freshArray(merged.notes);
  return merged;
}

function buildEffects(
  request: TransactionRequest,
  meta: ProgramMeta | null,
  verificationStatus: VerificationStatus,
  sim: SimulationResult,
  warnings: string[],
): EffectsSummary {
  if (sim.unlimitedApproval && !warnings.some((w) => w.includes('unlimited'))) {
    warnings.push('transaction grants an UNLIMITED token approval');
  }
  if (sim.applies === false) warnings.push('simulation indicates the call will revert');

  const asset = sim.asset || request.value || null;
  return decorateEffects({
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
  });
}

function normalizeRequest(input: TransactionRequest): TransactionRequest {
  if (!input || typeof input !== 'object') {
    throw new ProviderError('BAD_REQUEST', 'transaction request must be an object');
  }
  for (const field of ['dappId', 'session', 'programId', 'feePayer'] as const) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new ProviderError('BAD_REQUEST', `transaction request needs a non-empty ${field}`);
    }
  }
  if (input.message === undefined || input.message === null) {
    throw new ProviderError('BAD_REQUEST', 'transaction request needs message bytes');
  }
  let message: number[];
  if (typeof input.message === 'string') {
    const hex = toHex(input.message);
    message = [];
    for (let i = 0; i < hex.length; i += 2) message.push(parseInt(hex.slice(i, i + 2), 16));
  } else {
    message = freshArray<number>(input.message instanceof Uint8Array ? Array.from(input.message) : input.message);
  }
  toHex(message);
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

const STATE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  awaiting_approval: 'AwaitingApproval',
  approved: 'Approved',
  rejected: 'Rejected',
  signed: 'Signed',
  submitted: 'Submitted',
  failed: 'Failed',
});

export interface ProviderAdapters {
  FundingProvider?: MockFundingProvider;
  ProgramRegistry?: MockProgramRegistry;
  IdlProvider?: MockIdlProvider;
  CoreAuthorizer?: MockCoreAuthorizer;
  Signer?: MockSigner;
  Transport?: Transport;
  accounts?: AccountRef[];
}

export class ProclaimWalletProvider {
  readonly FundingProvider: MockFundingProvider;
  readonly ProgramRegistry: MockProgramRegistry;
  readonly IdlProvider: MockIdlProvider;
  readonly CoreAuthorizer: MockCoreAuthorizer;
  readonly Signer: MockSigner;
  readonly Transport: Transport;
  readonly accounts: AccountRef[];
  selectedAccountId: string | null = null;
  readonly proposals = new Map<string, ProposalRecord>();
  private nextRequest = 0;

  constructor({
    FundingProvider = new MockFundingProvider(),
    ProgramRegistry = new MockProgramRegistry(),
    IdlProvider = new MockIdlProvider(),
    CoreAuthorizer = new MockCoreAuthorizer(),
    Signer = new MockSigner(),
    Transport = denyTransport,
    accounts = defaultAccounts(),
  }: ProviderAdapters = {}) {
    this.FundingProvider = FundingProvider;
    this.ProgramRegistry = ProgramRegistry;
    this.IdlProvider = IdlProvider;
    this.CoreAuthorizer = CoreAuthorizer;
    this.Signer = Signer;
    this.Transport = Transport;
    this.accounts = cloneJson(accounts);
  }

  getCapabilities() {
    return {
      protocol: 'LP-0021-wallet-provider/phase0',
      submissionId: SUBMISSION_ID,
      capabilities: [...CAPABILITIES],
      accounts: { list: true, select: true, kinds: ['Public', 'Shielded'] },
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
      transport: {
        kind: this.Transport.kind || 'custom',
        networkDisabled: this.Transport.kind === 'deny',
        privacyInvariant: 'no direct sockets; egress only via injected Transport',
      },
    };
  }

  listAccounts(): AccountRef[] {
    return this.accounts.map((account) => ({ ...account }));
  }

  selectAccount(id: string): AccountRef {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new ProviderError('UNKNOWN_ACCOUNT', `unknown account: ${id}`);
    this.selectedAccountId = id;
    return { ...account };
  }

  getFundingOptions(accountId: string | null = this.selectedAccountId): FundingOption[] {
    return this.FundingProvider.getFundingOptions({ account: accountId });
  }

  requestFunding(options: { account?: string | null; optionId?: string | null; amount?: number | bigint | null } = {}) {
    const account = options.account ?? this.selectedAccountId;
    return this.FundingProvider.requestFunding({ ...options, account });
  }

  proposeTransaction(input: TransactionRequest): ProposalSnapshot {
    const request = normalizeRequest(input);
    const warnings: string[] = [];
    let meta: ProgramMeta | null = null;
    let verificationStatus: VerificationStatus = { kind: 'Unregistered' };
    let registryErrorKind: string | null = null;

    try {
      meta = this.ProgramRegistry.resolve(request.programId);
      verificationStatus = cloneJson(
        this.ProgramRegistry.verificationStatus(request.programId) || { kind: 'Unregistered' },
      );
    } catch (err) {
      registryErrorKind = err instanceof Error && 'kind' in err
        ? String((err as { kind: unknown }).kind)
        : 'Unavailable';
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`registry lookup failed (${registryErrorKind}: ${message}): showing unverified / unknown program`);
      verificationStatus = { kind: 'Unregistered' };
    }

    if (verificationStatus.kind === 'Mismatch') {
      warnings.push('program source image does not match the deployed program');
    } else if (verificationStatus.kind === 'DeployerClaimUnverified') {
      warnings.push('deployer source claim has not been independently verified');
    }

    let sim: SimulationResult;
    try {
      sim = normalizeSimulation(this.IdlProvider.decodeAndSimulate({ request: cloneJson(request), meta }));
      warnings.push(...sim.notes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`cannot render effects — IDL unavailable: ${message}`);
      sim = emptySimulationResult();
    }

    const effects = buildEffects(request, meta, verificationStatus, sim, warnings);
    this.nextRequest += 1;
    const id = `req-${this.nextRequest}`;
    const record: ProposalRecord = {
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

  effectsPreview(proposalId: string): EffectsSummary {
    const record = this._record(proposalId);
    if (!['awaiting_approval', 'approved', 'signed'].includes(record.state)) {
      throw new ProviderError('INVALID_STATE', `no effects in state ${record.state}`);
    }
    return cloneEffects(record.effects);
  }

  getEffectsPreview(proposalId: string): EffectsSummary {
    return this.effectsPreview(proposalId);
  }

  getProposal(proposalId: string): ProposalSnapshot {
    return this.snapshotProposal(this._record(proposalId));
  }

  stateOf(proposalId: string): ProposalState {
    return this._record(proposalId).state;
  }

  authorize(proposalId: string, context: AuthorizeContext = {}): string {
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

    let token: string;
    try {
      token = this.CoreAuthorizer.approve({ session, account, effects: cloneEffects(record.effects) });
    } catch (err) {
      if (err instanceof ProviderDenied) throw err;
      throw new ProviderDenied('Policy', `core authorizer refused: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!token) throw new ProviderDenied('Policy', 'core authorizer returned no approval token');

    record.state = 'approved';
    record.token = token;
    return token;
  }

  reject(proposalId: string, reason: string | null = null): ProposalSnapshot {
    const record = this._record(proposalId);
    if (record.state !== 'awaiting_approval') {
      throw new ProviderError('INVALID_STATE', `expected AwaitingApproval, got ${STATE_NAMES[record.state] || record.state}`);
    }
    record.state = 'rejected';
    record.reason = reason;
    return this.snapshotProposal(record);
  }

  signAndSubmit(proposalId: string): SubmissionReceipt {
    const record = this._record(proposalId);
    if (record.state !== 'approved') {
      throw new ProviderError(
        'NOT_APPROVED',
        `expected Approved, got ${STATE_NAMES[record.state] || record.state}`,
        { requestId: proposalId, expected: 'Approved', actual: record.state },
      );
    }

    let tx: SignedTransaction;
    try {
      tx = this.Signer.sign({
        requestId: proposalId,
        request: cloneJson(record.request),
        effects: cloneEffects(record.effects),
        token: record.token as string,
      });
    } catch (err) {
      record.state = 'failed';
      throw err;
    }
    record.state = 'signed';
    record.tx = tx;

    let receipt: SubmissionReceipt;
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

  private _record(proposalId: string): ProposalRecord {
    const record = this.proposals.get(proposalId);
    if (!record) throw new ProviderError('UNKNOWN_REQUEST', `unknown request: ${proposalId}`);
    return record;
  }

  private snapshotProposal(record: ProposalRecord): ProposalSnapshot {
    const effects = cloneEffects(record.effects);
    return {
      id: record.id,
      state: record.state,
      stateName: STATE_NAMES[record.state] || record.state,
      request: cloneJson(record.request),
      effects,
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
