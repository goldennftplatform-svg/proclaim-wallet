// SPDX-License-Identifier: MIT AND Apache-2.0
import type { Transport } from './transport.js';
import type { ProgramMeta, VerificationStatus } from './provider.js';

export interface HttpProgramRegistryOptions {
  transport: Transport;
  host: string;
  port?: number;
  tls?: boolean;
  basePath?: string;
}
export class HttpProgramRegistry {
  constructor(options: HttpProgramRegistryOptions);
  transport: Transport;
  host: string;
  port: number;
  tls: boolean;
  basePath: string;
  cache: Map<string, { meta: ProgramMeta | null; status: VerificationStatus | null }>;
  refresh(programId: string): Promise<{ meta: ProgramMeta | null; status: VerificationStatus | null } | null>;
  resolve(programId: string): ProgramMeta | null;
  verificationStatus(programId: string): VerificationStatus | null;
}
export default HttpProgramRegistry;
