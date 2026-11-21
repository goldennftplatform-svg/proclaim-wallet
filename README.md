<!-- SPDX-License-Identifier: MIT AND Apache-2.0 -->

# proclaim-wallet — LP-0021 reference SDK + CLI

A dependency-free reference implementation of the LEZ Wallet Provider surface:
a TypeScript SDK and a CLI that demonstrate the **approval gate** — no signing
without an explicit `authorize()` call — plus a **privacy-first transport seam**:
the wallet never opens a direct socket and the default transport refuses all
network access.

**One independent builder. Local, mock-backed reference code.** No chain calls,
no keystore integration, no Basecamp module, no on-chain deployment, no users,
no prize submission. Dual-licensed `MIT AND Apache-2.0` (both apply).

## Why this exists

A wallet provider that lets a dApp sign without an explicit, scoped user
approval is a security bug. This SDK models the boundary so integrators can see
and test the rules before writing real adapters:

- `proposeTransaction` returns a full human-readable effects preview and parks
  the proposal in `AwaitingApproval`.
- `signAndSubmit` refuses anything not in `Approved` state — verified by tests.
- `authorize` requires the matching session, account and capability, plus an
  explicit grant from the CoreAuthorizer. No grant, no signature.
- Registry/IDL failures degrade to a raw-calldata preview with warnings; they
  never bypass the gate.

## Install and try

```sh
git clone --branch v1.1.0 --depth 1 \
  https://github.com/goldennftplatform-svg/proclaim-wallet.git
cd proclaim-wallet
npm test                       # 35/35, Node >= 22, zero dependencies
node bin/proclaim-wallet.js capabilities
node bin/proclaim-wallet.js demo
node bin/proclaim-wallet.js attack --json   # exits 1 if any gate fails
node bin/proclaim-wallet.js lookup           # exits 1: network disabled by default
```

`attack` runs eight negative cases: premature sign, wrong capability, wrong
account, wrong session, rejected proposal, double authorize, replay, and
consent revoked mid-flow. All eight must be held.

## Use as an SDK

```js
import { ProclaimWalletProvider, MockCoreAuthorizer,
         sampleTransactionRequest } from '@goldennftplatform-svg/wallet-provider';

const authorizer = new MockCoreAuthorizer();       // replace with a real consent UI
const wallet = new ProclaimWalletProvider({ CoreAuthorizer: authorizer });
const proposal = wallet.proposeTransaction(sampleTransactionRequest());
// show wallet.getEffectsPreview(proposal.id) to the user...
authorizer.grant(proposal.request.session, proposal.request.feePayer);
wallet.authorize(proposal.id);
const receipt = wallet.signAndSubmit(proposal.id);
```

Swap any adapter (`FundingProvider`, `ProgramRegistry`, `IdlProvider`,
`CoreAuthorizer`, `Signer`) with real implementations. The gate logic is
adapter-independent and covered by negative tests.

## Privacy-first transport

By default the provider uses `denyTransport`: any network request throws
`DIRECT_NETWORK_DISABLED` before a socket is created. To allow egress, inject a
SOCKS5 transport explicitly:

```js
import { ProclaimWalletProvider, socks5Transport, HttpProgramRegistry } from
  '@goldennftplatform-svg/wallet-provider';

const transport = socks5Transport('socks5://127.0.0.1:9050');
const registry = new HttpProgramRegistry({ transport, host: 'registry.example' });
await registry.refresh('my-program');   // the only network call, via the proxy
const wallet = new ProclaimWalletProvider({ Transport: transport, ProgramRegistry: registry });
```

The SOCKS5 CONNECT carries the destination **domain name** (no local DNS), TLS
is pinned, and IP-literal destinations are rejected. The single socket is opened
to the proxy, never to the destination. Full threat model, gates and commands:
[`PRIVACY-TRANSPORT.md`](PRIVACY-TRANSPORT.md).

## Honest scope

This is **reference code with mock adapters** plus an opt-in proxy transport. It
is not a deployed wallet, not an on-chain program, not a Basecamp module, not
real cryptography or key storage, and not evidence of adoption or
prize-criterion completion. The proxy path hides the client IP from the
destination server, but the proxy/Tor exit still sees traffic; it is not
mixnet-grade anonymity. It ships so integrators can review and test the
approval-boundary and egress-boundary designs. See `RESULT.md` and
`PRIVACY-TRANSPORT.md`.
