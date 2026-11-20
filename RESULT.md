<!-- SPDX-License-Identifier: MIT AND Apache-2.0 -->

# What was actually run

Node v24.15.0, `node --test test/*.test.js`: **23 tests, 23 pass, 0 fail**.
That is 20 SDK tests plus 3 CLI tests that spawn the CLI as a subprocess.

- `node bin/proclaim-wallet.js demo` — propose, blocked premature sign,
  human-readable effects, explicit grant, authorize, submit. Exit 0.
- `node bin/proclaim-wallet.js attack --json` — 8 negative cases, all gates
  held, `allGatesHeld: true`, exit 0.

Not run / not claimed: no on-chain program, no sequencer, no Basecamp module,
no real keystore, no third-party integration, no testnet, no adoption. The
`Mock*` adapters are in-memory and their signatures are the literal string
`mock-signature-for-token-1` (base64 in the receipt is `6d6f636b...`).
