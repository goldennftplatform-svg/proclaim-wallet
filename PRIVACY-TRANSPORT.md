<!-- SPDX-License-Identifier: MIT AND Apache-2.0 -->

# Privacy-first transport seam — v1.1.0 result

**Date:** 2026-11-20  
**Result:** PASS — the wallet now has one enforceable network invariant:

> **The wallet never opens a direct socket. Outbound requests go only through an
> explicitly injected transport; the default transport refuses all network access.**

This is new construction on top of the shipped approval gate. It does **not**
claim anonymity, a deployed wallet, a Tor daemon integration, or prize credit.

---

## Why

The original `proclaim-wallet v1.0.0` had no network layer at all — zero
dependencies, in-memory mock adapters. That is good for safety but leaves a gap:
if a real wallet later connects to a sequencer, RPC endpoint, or bootstrap node,
the client IP is exposed to that endpoint and to observers.

This slice adds a transport seam so that the privacy property is a **testable
invariant** rather than a hope. A dApp cannot accidentally reach the network,
and every egress path is forced through a SOCKS5 proxy with the destination
domain sent to the proxy (no local DNS lookup).

---

## Threat model and limits

- Hides the client IP **from the destination server** when a SOCKS5 proxy (e.g.
  local Tor on `127.0.0.1:9050`) is used.
- SOCKS5 CONNECT uses `ATYP=3` (domain name), so the wallet never resolves the
  destination locally — no local DNS leak of the target.
- TLS is performed inside the established tunnel, pinned to an explicit CA;
  an untrusted certificate fails closed.
- **The proxy/Tor exit still sees the destination and traffic.** This is not
  mixnet-grade metadata resistance. No protection against a global passive
  observer, timing correlation, or a malicious proxy.
- No Tor/I2P daemon is installed or configured here. No public network call was
  made in testing; every test server is local.

---

## What changed

| File | Purpose |
| --- | --- |
| `src/transport.js` | The **only** file allowed to open a socket. `denyTransport` (default) throws `DIRECT_NETWORK_DISABLED`. `socks5Transport` implements no-auth SOCKS5 CONNECT + optional TLS using only Node built-ins (`node:net`, `node:tls`). Rejects IP-literal destinations. |
| `src/transport.ts`, `src/transport.d.ts` | Typed mirrors. |
| `src/net-adapters.js`, `.d.ts` | `HttpProgramRegistry`: optional network-backed registry adapter. Async `refresh()` goes through the Transport; sync `resolve()` feeds the unchanged approval gate. Refuses a deny transport. |
| `src/provider.js`, `.ts`, `.d.ts` | `Transport` injected via `ProviderAdapters`, default `denyTransport`. `getCapabilities()` reports `transport.kind`, `networkDisabled`, and the invariant. Approval logic unchanged. |
| `bin/proclaim-wallet.js` | New `lookup` command. Without `--socks5` it refuses network access; with it, a proxy-only registry fetch. |
| `test/transport.test.js` | 12 new tests: fake SOCKS5 proxy, socket instrumentation, DNS gate, TLS gate, adapter integration, static gate, zero-dependency gate, CLI default-deny. |
| `test/fixtures/{cert,key}.pem` | Local self-signed fixture for TLS tests (CN `proclaim.test`). |

Public exports: `denyTransport`, `socks5Transport`, `TransportError`,
`TRANSPORT_KINDS`, `HttpProgramRegistry`, and subpath exports
`@goldennftplatform-svg/wallet-provider/transport` and `/net-adapters`.

---

## Reproduce

```sh
git clone --branch v1.1.0 --depth 1 \
  https://github.com/goldennftplatform-svg/proclaim-wallet.git
cd proclaim-wallet
npm test                                   # 35/35
node bin/proclaim-wallet.js attack --json  # 8/8 gates held, exit 0
node bin/proclaim-wallet.js lookup          # exits 1: network disabled by default
node bin/proclaim-wallet.js lookup \
  --socks5 socks5://127.0.0.1:9050 \
  --host registry.example --port 443 --tls --program my-program
```

SDK usage:

```js
import {
  ProclaimWalletProvider,
  socks5Transport,
  HttpProgramRegistry,
} from '@goldennftplatform-svg/wallet-provider';

const transport = socks5Transport('socks5://127.0.0.1:9050');
const registry = new HttpProgramRegistry({ transport, host: 'registry.example', port: 443 });
await registry.refresh('my-program');            // only network call, via proxy
const wallet = new ProclaimWalletProvider({ ProgramRegistry: registry, Transport: transport });
// propose/authorize/signAndSubmit unchanged and still gated
```

---

## Test result

Node v24.15.0, `node --test test/*.test.js`: **35 tests, 35 pass, 0 fail**
(23 original + 12 privacy tests). The 8 attack cases still all hold.

Gates proven:

1. **Default deny:** `denyTransport.request()` throws `DIRECT_NETWORK_DISABLED`
   and opens zero sockets (instrumented `net.connect` / `tls.connect`).
2. **Static:** no `fetch`, `http.request`, `node:net`, `node:tls`, `dgram`, or
   `createConnection` in any wallet source file except `transport.js`.
3. **Runtime:** with `socks5Transport`, the fake proxy observes every request;
   the wallet opens exactly one raw socket — to the proxy — and never to the
   destination domain.
4. **DNS:** the SOCKS5 CONNECT record shows `ATYP=3` and the literal domain
   (`registry.example`), not an IP.
5. **TLS:** handshake completes inside the tunnel with a pinned CA; an
   untrusted certificate is rejected (no plaintext fallback).
6. **Dependencies:** `"dependencies": {}` and `"devDependencies": {}` still hold.
7. **Gate:** proposal → blocked premature sign → authorize → submit still works
   with a network-backed registry, and signing adds no network calls.
8. **CLI:** `lookup` without `--socks5` exits non-zero with a network-disabled
   error.

---

## Caveats / not claimed

- No Tor, I2P, mixnet, VPN, or relay deployment. A reachable SOCKS5 proxy is a
  prerequisite the caller supplies.
- No authentication on the SOCKS5 proxy (no-auth only, matching default Tor).
  No username/password secret handling in this slice.
- No chain adapter, keystore, on-chain deployment, real proof, or testnet result.
- No users, testimonials, third-party integrations, or adoption. Zero
  prize-criterion credit.
- This is reference code on one machine, tested only against local fixtures.
- Dual-licensed `MIT AND Apache-2.0`; both obligations apply.
