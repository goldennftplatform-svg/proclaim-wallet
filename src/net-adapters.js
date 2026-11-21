// SPDX-License-Identifier: MIT AND Apache-2.0
// Optional network-backed adapters. All egress goes through the injected
// Transport; this file never opens a socket itself. Mocks remain the defaults.
//
// The provider's approval gate is synchronous, so the async fetch happens in
// `refresh()` and the result is cached for the synchronous `resolve()` path.

import { TransportError } from './transport.js';

export class HttpProgramRegistry {
  constructor({ transport, host, port = 443, tls = true, basePath = '/api' } = {}) {
    if (!transport || transport.kind === 'deny') {
      throw new TransportError(
        'TRANSPORT_REQUIRED',
        'HttpProgramRegistry needs an explicit non-deny transport (e.g. socks5Transport)',
      );
    }
    if (typeof host !== 'string' || !host || host.includes('/')) {
      throw new TransportError('BAD_HOST', 'registry host must be a domain name');
    }
    this.transport = transport;
    this.host = host;
    this.port = port;
    this.tls = tls;
    this.basePath = basePath;
    this.cache = new Map();
  }

  /** Fetch program metadata/status through the Transport and cache it. */
  async refresh(programId) {
    const path = `${this.basePath}/programs/${encodeURIComponent(programId)}`;
    const res = await this.transport.request({
      host: this.host,
      port: this.port,
      tls: this.tls,
      method: 'GET',
      path,
      headers: { Accept: 'application/json' },
    });
    if (res.status !== 200) {
      this.cache.delete(programId);
      return null;
    }
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      this.cache.delete(programId);
      return null;
    }
    const entry = { meta: data.meta ?? null, status: data.status ?? null };
    this.cache.set(programId, entry);
    return entry;
  }

  // Synchronous surface used by ProclaimWalletProvider.proposeTransaction().
  resolve(programId) {
    return this.cache.get(programId)?.meta ?? null;
  }

  verificationStatus(programId) {
    return this.cache.get(programId)?.status ?? null;
  }
}

export default HttpProgramRegistry;
