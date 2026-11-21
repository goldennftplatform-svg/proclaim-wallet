// SPDX-License-Identifier: MIT AND Apache-2.0
// Privacy-first transport seam for proclaim-wallet.
//
// Zero runtime dependencies. The ONLY place in this package that may open a
// socket is this file. `denyTransport` is the default, so the wallet refuses
// all network access until a caller explicitly injects a transport.
//
// `socks5Transport` performs a no-auth SOCKS5 CONNECT using the domain name
// (ATYP=3), so no local DNS lookup happens for the destination. The proxy/Tor
// exit still sees the destination; this is not mixnet-grade anonymity.

import net from 'node:net';
import tls from 'node:tls';

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

export class TransportError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Default: never open a socket. */
export const denyTransport = Object.freeze({
  kind: 'deny',
  async request() {
    throw new TransportError(
      'DIRECT_NETWORK_DISABLED',
      'network access is disabled; inject socks5Transport() explicitly',
    );
  },
});

function assertDomain(host) {
  if (typeof host !== 'string' || host.length === 0) {
    throw new TransportError('BAD_HOST', 'host must be a non-empty domain name');
  }
  if (IPV4_RE.test(host) || host.includes(':') || host.includes('/')) {
    throw new TransportError(
      'IP_LITERAL_FORBIDDEN',
      'destination must be a domain name so the proxy resolves it, not an IP literal',
      { host },
    );
  }
  return host;
}

function parseProxy(arg) {
  let proxyHost;
  let proxyPort;
  let options = {};
  if (typeof arg === 'string') {
    const m = /^socks5:\/\/([^:/]+):(\d{1,5})$/.exec(arg);
    if (!m) throw new TransportError('BAD_PROXY', 'expected socks5://host:port');
    proxyHost = m[1];
    proxyPort = Number(m[2]);
  } else if (arg && typeof arg === 'object') {
    proxyHost = arg.proxyHost ?? arg.host;
    proxyPort = arg.proxyPort ?? arg.port;
    options = arg;
  }
  if (!proxyHost || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
    throw new TransportError('BAD_PROXY', 'proxy needs a host and a valid port');
  }
  return { proxyHost, proxyPort, options };
}

/** Small exact-read helper over a stream, with leftover buffering. */
class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.ended = false;
    this.error = null;
    this.onData = (chunk) => { this.buf = Buffer.concat([this.buf, chunk]); this.flush(); };
    this.onEnd = () => { this.ended = true; this.flush(); };
    this.onError = (err) => { this.error = err; this.flush(); };
    socket.on('data', this.onData);
    socket.on('end', this.onEnd);
    socket.on('error', this.onError);
  }

  flush() {
    while (this.waiters.length) {
      const w = this.waiters[0];
      if (this.buf.length >= w.n) {
        const out = this.buf.subarray(0, w.n);
        this.buf = this.buf.subarray(w.n);
        this.waiters.shift();
        w.resolve(out);
      } else if (this.ended || this.error) {
        this.waiters.shift();
        w.reject(this.error || new TransportError('SOCKET_CLOSED', 'socket closed before read'));
      } else {
        break;
      }
    }
  }

  read(n) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ n, resolve, reject });
      this.flush();
    });
  }

  dispose() {
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('error', this.onError);
  }
}

async function socks5Connect(reader, socket, host, port) {
  socket.write(Buffer.from([0x05, 0x01, 0x00])); // no-auth only
  const method = await reader.read(2);
  if (method[0] !== 0x05 || method[1] !== 0x00) {
    throw new TransportError('SOCKS_AUTH_UNSUPPORTED', 'proxy did not accept no-auth SOCKS5');
  }

  const hostBuf = Buffer.from(host, 'ascii');
  if (hostBuf.length > 255) throw new TransportError('BAD_HOST', 'host too long for SOCKS5');
  socket.write(Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
    hostBuf,
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
  ]));

  const head = await reader.read(4);
  if (head[0] !== 0x05 || head[1] !== 0x00) {
    throw new TransportError('SOCKS_CONNECT_REJECTED', `SOCKS5 CONNECT failed with code ${head[1]}`);
  }
  const atyp = head[3];
  if (atyp === 0x01) await reader.read(4);
  else if (atyp === 0x03) { const len = (await reader.read(1))[0]; await reader.read(len); }
  else if (atyp === 0x04) await reader.read(16);
  else throw new TransportError('SOCKS_BAD_REPLY', `unknown SOCKS5 address type ${atyp}`);
  await reader.read(2); // bound port
}

function buildHttpRequest(req) {
  const headers = {
    Host: `${req.host}:${req.port}`,
    Connection: 'close',
    ...(req.headers || {}),
  };
  let head = `${req.method} ${req.path} HTTP/1.1\r\n`;
  for (const [key, value] of Object.entries(headers)) head += `${key}: ${value}\r\n`;
  head += '\r\n';
  return Buffer.concat([Buffer.from(head, 'ascii'), Buffer.from(req.body || '', 'utf8')]);
}

async function readHttpResponse(reader) {
  let raw = Buffer.alloc(0);
  while (!raw.includes('\r\n\r\n')) {
    raw = Buffer.concat([raw, await reader.read(1)]);
    if (raw.length > 65536) throw new TransportError('HTTP_HEADER_TOO_LARGE', 'response headers too large');
  }
  const sep = raw.indexOf('\r\n\r\n');
  const headText = raw.subarray(0, sep).toString('latin1');
  let body = raw.subarray(sep + 4);
  const lines = headText.split('\r\n');
  const statusMatch = /^HTTP\/1\.[01] (\d{3})/.exec(lines.shift() || '');
  if (!statusMatch) throw new TransportError('HTTP_BAD_RESPONSE', 'missing HTTP status line');
  const status = Number(statusMatch[1]);
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const length = headers['content-length'];
  if (length !== undefined) {
    const want = Number(length);
    while (body.length < want) body = Buffer.concat([body, await reader.read(1)]);
  } else {
    try {
      for (;;) body = Buffer.concat([body, await reader.read(1)]);
    } catch (err) {
      if (err.code !== 'SOCKET_CLOSED' && !(err instanceof TransportError)) throw err;
    }
  }
  return { status, headers, body: body.toString('utf8') };
}

/**
 * Build a transport that sends every request through a no-auth SOCKS5 proxy.
 * Accepts 'socks5://host:port' or { proxyHost, proxyPort, ca, timeoutMs }.
 */
export function socks5Transport(arg) {
  const { proxyHost, proxyPort, options } = parseProxy(arg);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    kind: 'socks5',
    proxyHost,
    proxyPort,

    async request(req) {
      if (!req || typeof req !== 'object') throw new TransportError('BAD_REQUEST', 'request must be an object');
      const host = assertDomain(req.host);
      const port = req.port;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new TransportError('BAD_PORT', 'destination port must be 1..65535');
      }
      const method = req.method === 'POST' ? 'POST' : 'GET';
      const path = typeof req.path === 'string' && req.path.startsWith('/') ? req.path : '/';

      // The only socket opened here is to the PROXY. Never to req.host.
      const socket = net.connect({ host: proxyHost, port: proxyPort });
      socket.setTimeout(timeoutMs, () => socket.destroy(new TransportError('TIMEOUT', 'transport timed out')));

      let reader = new SocketReader(socket);
      let stream = socket;
      try {
        await socks5Connect(reader, socket, host, port);
        if (req.tls) {
          reader.dispose();
          stream = tls.connect({
            socket,
            servername: host,
            ca: options.ca,
            rejectUnauthorized: options.rejectUnauthorized ?? true,
          });
          stream.setTimeout(timeoutMs, () => stream.destroy(new TransportError('TIMEOUT', 'TLS timed out')));
          await new Promise((resolve, reject) => {
            stream.once('secureConnect', resolve);
            stream.once('error', reject);
          });
          reader = new SocketReader(stream);
        }
        stream.write(buildHttpRequest({ ...req, host, port, method, path }));
        return await readHttpResponse(reader);
      } finally {
        reader.dispose();
        stream.destroy();
        if (stream !== socket) socket.destroy();
      }
    },
  };
}

export const TRANSPORT_KINDS = Object.freeze(['deny', 'socks5']);
