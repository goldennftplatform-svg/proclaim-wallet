// SPDX-License-Identifier: MIT AND Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

import {
  denyTransport,
  socks5Transport,
  TransportError,
  TRANSPORT_KINDS,
} from '../src/transport.js';
import { HttpProgramRegistry } from '../src/net-adapters.js';
import { ProclaimWalletProvider, sampleTransactionRequest } from '../src/provider.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test harness: a local fake SOCKS5 proxy. It records the CONNECT target,
// optionally tunnels raw TCP, and can answer a tunnelled HTTP request.
// ---------------------------------------------------------------------------
async function startSocks5({ responder, tunnelTo } = {}) {
  const seen = [];
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('error', () => {});
    let phase = 'greeting';
    let buf = Buffer.alloc(0);

    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (phase === 'greeting') {
          if (buf.length < 2) return;
          const nmethods = buf[1];
          if (buf.length < 2 + nmethods) return;
          buf = buf.subarray(2 + nmethods);
          sock.write(Buffer.from([0x05, 0x00])); // no-auth accepted
          phase = 'connect';
          continue;
        }
        if (phase === 'connect') {
          if (buf.length < 5) return;
          const atyp = buf[3];
          let host;
          let idx;
          if (atyp === 0x03) {
            const len = buf[4];
            if (buf.length < 5 + len + 2) return;
            host = buf.subarray(5, 5 + len).toString('ascii');
            idx = 5 + len;
          } else if (atyp === 0x01) {
            if (buf.length < 10) return;
            host = Array.from(buf.subarray(4, 8)).join('.');
            idx = 8;
          } else {
            sock.destroy();
            return;
          }
          const port = (buf[idx] << 8) | buf[idx + 1];
          buf = buf.subarray(idx + 2);
          seen.push({ host, port, atyp });
          sock.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

          if (tunnelTo) {
            const upstream = net.connect(tunnelTo.port, tunnelTo.host);
            upstream.on('connect', () => {
              if (buf.length) upstream.write(buf);
              buf = Buffer.alloc(0);
            });
            upstream.on('data', (d) => sock.write(d));
            upstream.on('error', () => sock.destroy());
            sock.on('data', (d) => upstream.write(d));
            sock.on('close', () => upstream.destroy());
            phase = 'piping';
            return;
          }
          phase = 'tunnel';
          continue;
        }
        if (phase === 'tunnel') {
          const sep = buf.indexOf('\r\n\r\n');
          if (sep === -1) return;
          const body = responder
            ? responder(buf.subarray(0, sep).toString('latin1'))
            : 'proxied-ok';
          sock.write(
            'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n' +
            `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          );
          sock.end();
          buf = Buffer.alloc(0);
          phase = 'done';
          return;
        }
        return;
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    server,
    port: server.address().port,
    seen,
    close: () => new Promise((r) => {
      for (const s of sockets) s.destroy();
      server.close(r);
    }),
  };
}

function instrumentSockets() {
  const attempts = [];
  const origNet = net.connect;
  const origTls = tls.connect;
  net.connect = function (...args) {
    const opts = args[0] || {};
    attempts.push({ api: 'net', host: opts.host ?? opts[0], port: opts.port ?? opts[1] });
    return origNet.apply(this, args);
  };
  tls.connect = function (...args) {
    const opts = args[0] || {};
    attempts.push({ api: 'tls', host: opts.host ?? opts.socket?._host, port: opts.port });
    return origTls.apply(this, args);
  };
  return {
    attempts,
    restore() {
      net.connect = origNet;
      tls.connect = origTls;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Default deny
// ---------------------------------------------------------------------------
test('denyTransport refuses every request and opens zero sockets', async () => {
  const spy = instrumentSockets();
  try {
    await assert.rejects(
      denyTransport.request({ host: 'anything.example', port: 443 }),
      (err) => err instanceof TransportError && err.code === 'DIRECT_NETWORK_DISABLED',
    );
    assert.equal(spy.attempts.length, 0, 'must not open a socket');
  } finally {
    spy.restore();
  }
});

test('a provider created with no options is network-disabled by default', () => {
  const provider = new ProclaimWalletProvider();
  assert.equal(provider.Transport.kind, 'deny');
  const caps = provider.getCapabilities();
  assert.equal(caps.transport.kind, 'deny');
  assert.equal(caps.transport.networkDisabled, true);
  assert.match(caps.transport.privacyInvariant, /no direct sockets/);
});

// ---------------------------------------------------------------------------
// 2. SOCKS5 routing + DNS gate
// ---------------------------------------------------------------------------
test('socks5Transport sends the domain name to the proxy and opens only proxy sockets', async () => {
  const proxy = await startSocks5();
  const spy = instrumentSockets();
  try {
    const transport = socks5Transport(`socks5://127.0.0.1:${proxy.port}`);
    const res = await transport.request({
      host: 'registry.example',
      port: 8080,
      tls: false,
      method: 'POST',
      path: '/api/lookup',
      body: '{"programId":"p1"}',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body, 'proxied-ok');

    assert.equal(proxy.seen.length, 1);
    assert.equal(proxy.seen[0].host, 'registry.example', 'proxy must see the domain, not a resolved IP');
    assert.equal(proxy.seen[0].atyp, 0x03, 'SOCKS5 ATYP must be DOMAINNAME');
    assert.equal(proxy.seen[0].port, 8080);

    assert.equal(spy.attempts.length, 1, 'only one socket: the proxy');
    assert.equal(spy.attempts[0].host, '127.0.0.1');
    assert.equal(spy.attempts[0].port, proxy.port);
  } finally {
    spy.restore();
    await proxy.close();
  }
});

test('socks5Transport rejects IP-literal destinations (forces domain resolution at proxy)', async () => {
  const transport = socks5Transport('socks5://127.0.0.1:1080');
  for (const bad of ['127.0.0.1', '192.168.1.10', '::1']) {
    await assert.rejects(
      transport.request({ host: bad, port: 80 }),
      (err) => err.code === 'IP_LITERAL_FORBIDDEN',
    );
  }
});

test('socks5Transport reports its kind and proxy endpoint', () => {
  const t = socks5Transport({ proxyHost: '127.0.0.1', proxyPort: 9050 });
  assert.equal(t.kind, 'socks5');
  assert.equal(t.proxyHost, '127.0.0.1');
  assert.equal(t.proxyPort, 9050);
  assert.deepEqual([...TRANSPORT_KINDS], ['deny', 'socks5']);
});

// ---------------------------------------------------------------------------
// 3. TLS gate: handshake occurs inside the SOCKS tunnel, pinned to a CA
// ---------------------------------------------------------------------------
test('socks5Transport completes TLS inside the tunnel with no plaintext fallback', async () => {
  const key = fs.readFileSync(path.join(HERE, 'fixtures', 'key.pem'));
  const cert = fs.readFileSync(path.join(HERE, 'fixtures', 'cert.pem'));

  const tlsServer = tls.createServer({ key, cert }, (socket) => {
    socket.on('data', () => {
      socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok');
    });
  });
  await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));

  const proxy = await startSocks5({ tunnelTo: { host: '127.0.0.1', port: tlsServer.address().port } });
  const spy = instrumentSockets();
  try {
    const transport = socks5Transport({
      proxyHost: '127.0.0.1',
      proxyPort: proxy.port,
      ca: cert,
      rejectUnauthorized: true,
    });
    const res = await transport.request({
      host: 'proclaim.test',
      port: 443,
      tls: true,
      method: 'GET',
      path: '/secure',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body, 'ok');
    assert.equal(proxy.seen[0].host, 'proclaim.test');
    assert.equal(proxy.seen[0].atyp, 0x03);

    // The wallet opens exactly one raw socket: to the proxy. TLS wraps that
    // socket rather than opening a new one, and there is never a direct socket
    // to the destination domain. (The harness's own upstream socket to the
    // local TLS server is not wallet traffic.)
    const walletRaw = spy.attempts.filter((a) => a.api === 'net' && a.port === proxy.port);
    assert.equal(walletRaw.length, 1, 'wallet must open exactly one socket: the proxy');
    assert.equal(spy.attempts.filter((a) => a.api === 'tls').length, 1, 'TLS wraps the proxied socket');
    assert.ok(
      !spy.attempts.some((a) => a.host === 'proclaim.test'),
      'no direct socket to the destination domain',
    );
  } finally {
    spy.restore();
    await proxy.close();
    await new Promise((r) => tlsServer.close(r));
  }
});

test('TLS rejects an untrusted certificate (no silent downgrade)', async () => {
  const key = fs.readFileSync(path.join(HERE, 'fixtures', 'key.pem'));
  const cert = fs.readFileSync(path.join(HERE, 'fixtures', 'cert.pem'));
  const tlsServer = tls.createServer({ key, cert }, (socket) => socket.on('data', () => socket.end()));
  await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
  const proxy = await startSocks5({ tunnelTo: { host: '127.0.0.1', port: tlsServer.address().port } });
  try {
    const transport = socks5Transport({
      proxyHost: '127.0.0.1', proxyPort: proxy.port, rejectUnauthorized: true,
    });
    await assert.rejects(
      transport.request({ host: 'proclaim.test', port: 443, tls: true, path: '/' }),
      /self-signed|certificate|unable to verify/i,
    );
  } finally {
    await proxy.close();
    await new Promise((r) => tlsServer.close(r));
  }
});

// ---------------------------------------------------------------------------
// 4. A real (proxy-only) adapter feeding the approval gate
// ---------------------------------------------------------------------------
test('network-backed registry adapter resolves via proxy; approval gate still holds', async () => {
  const meta = {
    programId: 'prog-privacy-1',
    name: 'privacy-registry',
    version: '1.0.0',
    author: 'test',
    description: 'fixture',
    idlPointer: null,
    codePointer: 'git+https://example.invalid/x#abc',
    registeredAt: '2026-11-20T00:00:00Z',
  };
  const status = { kind: 'LocallyVerified', sourceCommit: 'abc', imageId: 'img' };
  const proxy = await startSocks5({
    responder: () => JSON.stringify({ meta, status }),
  });
  const spy = instrumentSockets();
  try {
    const transport = socks5Transport(`socks5://127.0.0.1:${proxy.port}`);
    const registry = new HttpProgramRegistry({
      transport,
      host: 'registry.example',
      port: 9443,
      tls: false,
    });
    await registry.refresh('prog-privacy-1');

    assert.equal(proxy.seen.length, 1);
    assert.equal(proxy.seen[0].host, 'registry.example');
    assert.equal(spy.attempts.length, 1, 'adapter opened only the proxy socket');

    const provider = new ProclaimWalletProvider({
      ProgramRegistry: registry,
      Transport: transport,
    });
    const proposal = provider.proposeTransaction(sampleTransactionRequest({ programId: 'prog-privacy-1' }));
    assert.equal(proposal.effects.programName, 'privacy-registry');

    // Gate unchanged: no signing before authorize.
    assert.throws(() => provider.signAndSubmit(proposal.id), (e) => e.code === 'NOT_APPROVED');
    assert.equal(spy.attempts.length, 1, 'signing does not add network calls');
  } finally {
    spy.restore();
    await proxy.close();
  }
});

test('HttpProgramRegistry refuses a deny transport', () => {
  assert.throws(
    () => new HttpProgramRegistry({ transport: denyTransport, host: 'x.example' }),
    (err) => err instanceof TransportError && err.code === 'TRANSPORT_REQUIRED',
  );
});

// ---------------------------------------------------------------------------
// 5. Static gate: network primitives confined to transport.js
// ---------------------------------------------------------------------------
test('no network primitives outside src/transport.js', () => {
  const srcDir = path.join(HERE, '..', 'src');
  const banned = /\b(fetch|XMLHttpRequest|http\.request|https\.request|createServer|createConnection|dgram|node:net|node:tls)\b/;
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.js') || file === 'transport.js' || file === 'net-adapters.js') continue;
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    assert.ok(!banned.test(text), `${file} contains a direct network primitive`);
  }
});

test('package still declares zero runtime dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.devDependencies, {});
});

test('CLI lookup is proxy-only: without --socks5 it refuses network access', async () => {
  const cli = path.join(HERE, '..', 'bin', 'proclaim-wallet.js');
  await assert.rejects(
    execFileP(process.execPath, [cli, 'lookup']),
    (err) => /TRANSPORT_REQUIRED|DIRECT_NETWORK_DISABLED/.test(err.stderr || ''),
  );
});
