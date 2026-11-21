// SPDX-License-Identifier: MIT AND Apache-2.0
// Public surface of proclaim-wallet. Hand-authored from provider.ts.
export type AccountKind = 'Public' | 'Shielded';
export type Capability = 'ProposeTransaction' | string;
export type VerificationBadge = 'verified-local' | 'verified-remote' | 'mismatch' | 'unregistered' | 'unknown' | string;
export type ProposalState = 'awaiting_approval' | 'approved' | 'rejected' | 'submitted' | 'failed' | string;

export interface AccountRef { id: string; kind: AccountKind; label?: string; [k: string]: unknown }
export interface ProgramMeta { programId: string; name: string; version: string; authority?: string; [k: string]: unknown }
export interface Asset { symbol: string; decimals: number; amount?: number | bigint; [k: string]: unknown }
export interface AssetMovement { [k: string]: unknown }
export interface SimulationResult { [k: string]: unknown }
export interface EffectsSummary { [k: string]: unknown }
export interface TransactionRequest {
  session: string; feePayer: string; programId: string; [k: string]: unknown;
}
export interface SignedTransaction { [k: string]: unknown }
export interface SubmissionReceipt {
  requestId: string; accepted: boolean; signatureHex: string; [k: string]: unknown;
}
export interface ProposalSnapshot {
  id: string; state: ProposalState; stateName: string; request: TransactionRequest;
  effects: EffectsSummary; warnings: string[]; [k: string]: unknown;
}
export interface AuthorizeContext {
  capability?: Capability; session?: string; account?: string; [k: string]: unknown;
}
export interface FundingOption { id: string; [k: string]: unknown }
export interface VerificationStatus { [k: string]: unknown }
export interface TransportRequest {
  host: string; port: number; tls?: boolean; method?: 'GET' | 'POST';
  path?: string; headers?: Record<string, string>; body?: string;
}
export interface TransportResponse { status: number; headers: Record<string, string>; body: string }
export interface Transport { kind: string; request(req: TransportRequest): Promise<TransportResponse> }
export class TransportError extends Error { code: string; constructor(code: string, message: string, extra?: Record<string, unknown>) }
export const denyTransport: Transport;
export function socks5Transport(arg: string | { proxyHost?: string; proxyPort?: number; host?: string; port?: number; ca?: unknown; timeoutMs?: number }): Transport;
export const TRANSPORT_KINDS: readonly string[];

export interface ProviderAdapters {
  FundingProvider?: MockFundingProvider; ProgramRegistry?: MockProgramRegistry;
  IdlProvider?: MockIdlProvider; CoreAuthorizer?: MockCoreAuthorizer;
  Signer?: MockSigner; Transport?: Transport; accounts?: AccountRef[];
}

export class ProviderError extends Error { code: string; constructor(code: string, message: string) }
export class ProviderDenied extends ProviderError { kind?: string; constructor(code: string, message: string, extra?: Record<string, unknown>) }

export function toHex(bytes: number[] | Uint8Array | string): string;
export function verificationBadge(status: VerificationStatus | null | undefined): string;
export function verificationBadgeForProposal(proposal: ProposalSnapshot): string;
export function effectsToHumanLines(effects: EffectsSummary): string[];
export function cloneEffects(effects: EffectsSummary): EffectsSummary;
export function defaultAccounts(): AccountRef[];
export function sampleTransactionRequest(overrides?: Partial<TransactionRequest>): TransactionRequest;
export function sampleProgramMeta(overrides?: Partial<ProgramMeta>): ProgramMeta;
export function sampleVerificationStatus(): VerificationStatus;
export function sampleSimulationResult(overrides?: Partial<SimulationResult>): SimulationResult;
export function emptySimulationResult(): SimulationResult;

export class MockFundingProvider {
  getFundingOptions(o: { account?: string | null }): FundingOption[];
  requestFunding(o: Record<string, unknown>): { ok: boolean; [k: string]: unknown };
}
export class MockProgramRegistry {
  withProgram(meta: ProgramMeta, status: VerificationStatus): this;
  resolve(programId: string): { meta: ProgramMeta; status: VerificationStatus } | null;
}
export class MockIdlProvider {
  withResult(program: string, result: SimulationResult): this;
  preview(request: TransactionRequest): SimulationResult;
}
export class MockCoreAuthorizer {
  grant(session: string, account: string): this;
  denyAll(): this;
  approve(ctx: { session: string; account: string }): string;
  logSnapshot(): { calls: number; grantsUsed: number };
}
export class MockSigner {
  signAndSubmit(tx: SignedTransaction): SubmissionReceipt;
  logSnapshot(): { signCalls: number; submitCalls: number };
}

export class ProclaimWalletProvider {
  readonly FundingProvider: MockFundingProvider;
  readonly ProgramRegistry: MockProgramRegistry;
  readonly IdlProvider: MockIdlProvider;
  readonly CoreAuthorizer: MockCoreAuthorizer;
  readonly Signer: MockSigner;
  readonly Transport: Transport;
  readonly accounts: AccountRef[];
  selectedAccountId: string | null;
  readonly proposals: Map<string, ProposalSnapshot>;
  constructor(adapters?: ProviderAdapters);
  getCapabilities(): Record<string, unknown>;
  listAccounts(): AccountRef[];
  selectAccount(id: string): AccountRef;
  getFundingOptions(accountId?: string | null): FundingOption[];
  requestFunding(o?: Record<string, unknown>): { ok: boolean; [k: string]: unknown };
  proposeTransaction(input: TransactionRequest): ProposalSnapshot;
  effectsPreview(proposalId: string): EffectsSummary;
  getEffectsPreview(proposalId: string): EffectsSummary;
  getProposal(proposalId: string): ProposalSnapshot;
  stateOf(proposalId: string): ProposalState;
  authorize(proposalId: string, context?: AuthorizeContext): string;
  reject(proposalId: string, reason?: string | null): ProposalSnapshot;
  signAndSubmit(proposalId: string): SubmissionReceipt;
}
export default ProclaimWalletProvider;

export const SUBMISSION_ID: string;
export const TARGET_ZONE: string;
export const CAPABILITIES: readonly Capability[];
export const VERIFICATION_BADGES: readonly VerificationBadge[];
export const EFFECTS_FIELDS: readonly string[];
