// SPDX-License-Identifier: MIT AND Apache-2.0
export interface TransportRequest {
  host: string;
  port: number;
  tls?: boolean;
  method?: 'GET' | 'POST';
  path?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface Transport {
  kind: string;
  request(req: TransportRequest): Promise<TransportResponse>;
  proxyHost?: string;
  proxyPort?: number;
}
export interface Socks5Options {
  proxyHost?: string;
  proxyPort?: number;
  host?: string;
  port?: number;
  ca?: unknown;
  timeoutMs?: number;
  rejectUnauthorized?: boolean;
}
export class TransportError extends Error {
  code: string;
  constructor(code: string, message: string, extra?: Record<string, unknown>);
}
export const denyTransport: Transport;
export function socks5Transport(arg: string | Socks5Options): Transport;
export const TRANSPORT_KINDS: readonly string[];
