<!-- SPDX-License-Identifier: MIT AND Apache-2.0 -->

# What was actually run

Node v24.15.0, `node --test test/*.test.js`: **35 tests, 35 pass, 0 fail**.
That is the original 23 (20 SDK + 3 CLI) plus 12 new privacy-transport tests.

v1.1.0 privacy gates (see `PRIVACY-TRANSPORT.md`): default deny opens zero
sockets; static scan finds no network primitives outside `transport.js`; the
fake SOCKS5 proxy observes every request with `ATYP=3` domain names and no
direct destination socket; TLS completes inside the tunnel with a pinned CA and
rejects untrusted certs; the network-backed registry still holds the approval
gate; zero dependencies remain; CLI `lookup` is proxy-only.

- `node bin/proclaim-wallet.js demo` — propose, blocked premature sign,
  human-readable effects, explicit grant, authorize, submit. Exit 0.
- `node bin/proclaim-wallet.js attack --json` — 8 negative cases, all gates
  held, `allGatesHeld: true`, exit 0.

Not run / not claimed: no on-chain program, no sequencer, no Basecamp module,
no real keystore, no third-party integration, no testnet, no adoption. The
`Mock*` adapters are in-memory and their signatures are the literal string
`mock-signature-for-token-1` (base64 in the receipt is `6d6f636b...`).
