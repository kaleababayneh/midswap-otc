# KAAMOS — Cross-Chain Atomic Swap (Midnight ⇄ Cardano)

Trustless settlement between **Midnight** (privacy L1) and **Cardano Preprod** via
hash-time-locked contracts: Compact contracts on Midnight, Aiken validators on
Cardano, browser-side reducers, and a Fastify orchestrator that acts as an
advisory fast-path. **Chain state is authoritative; the orchestrator is a view +
preimage relay.**

> GitHub topics: `midnightntwrk`, `compact`.

## Architecture

Two chains, mirrored HTLCs, single SHA-256 hash lock shared across both
ecosystems.

| Direction          | Order                                                                  |
|--------------------|------------------------------------------------------------------------|
| `usdm-usdc` (fwd)  | maker locks USDM on Cardano → taker deposits USDC on Midnight → maker withdraws (preimage written to Midnight ledger) → taker withdraws on Cardano |
| `usdc-usdm` (rev)  | mirror; preimage propagates via Cardano spend redeemer (`/txs/{h}/redeemers`) or orchestrator fast-path |

Standard HTLC safety: the second party's deadline is strictly tighter than the
first's (5 min buffer); a `+1000 ms` offset before `validFrom` works around
Cardano slot-flooring on reclaim. KAAMOS layers an institutional OTC desk on
top — Supabase auth, RFQ/quote/counter/accept order book, per-deal wallet
binding — without changing Layer-1 invariants.

## Repository layout

| Path                | Purpose                                                       |
|---------------------|---------------------------------------------------------------|
| `contract/`         | Compact contracts — HTLC + USDC native unshielded token       |
| `cardano/`          | Aiken validators — HTLC + USDM minting policy (Plutus V3)     |
| `htlc-ft-cli/`      | TypeScript CLI driver (forward-flow regression)               |
| `htlc-ui/`          | React 19 + Vite frontend — wallet connect, swap UX, OTC desk  |
| `htlc-orchestrator/`| Fastify + better-sqlite3 advisory indexer + REST API + watchers |

npm workspaces from the repo root; Node `>=24.11.1`; ES modules throughout.

## Compact contracts

Sources under `contract/src/`; pragma `language_version >= 0.21.0`. Compiled
artefacts (proving keys, ZK IR, contract module) live under
`contract/src/managed/{htlc,usdc}/{compiler,contract,keys,zkir}/`.

**`htlc.compact`** — color-parametric hash-time-lock with three circuits and
seven parallel `Map<Bytes<32>, …>` ledgers keyed by the hash lock so multiple
swaps coexist:

- `deposit(color, amount, hash, expiryTime, receiverAuth, receiverPayout, senderPayout)` —
  pulls native unshielded coins of `color` via `receiveUnshielded`, captures
  sender identity from `ownPublicKey().bytes`, populates the seven maps.
- `withdrawWithPreimage(preimage)` — derives the lock as
  `persistentHash<Bytes<32>>(preimage)`, asserts
  `ownPublicKey().bytes == htlcReceiverAuth`, calls `sendUnshielded`, and
  writes the preimage to `revealedPreimages[hash]` so the counterparty chain
  can read it from contract state.
- `reclaimAfterExpiry(hash)` — sender-only, gated by `blockTimeGt(expiry)`.

**`usdc.compact`** — minimal native token. `mint()` calls
`mintUnshieldedToken(_domainSep, amount, recipient)`; coins live as Zswap
UTXOs, no internal balance map.

### Private state, witnesses, ZK commitments

- **Witnesses.** `contract/src/witnesses.ts` defines a `BBoardPrivateState
  { secretKey: Uint8Array }` and a `localSecretKey` witness threaded through
  `WitnessContext<Ledger, BBoardPrivateState>`.
- **Persistent hash.** The HTLC commits to the preimage exclusively through
  `persistentHash<Bytes<32>>(preimage)` — equivalent (and unit-tested) to
  Node's `createHash('sha256')` and Aiken's `sha2_256`. Equivalence is the
  load-bearing invariant of the cross-chain swap.
- **ZK assets.** Proving keys + ZK IR in `contract/src/managed/{htlc,usdc}/
  {keys,zkir}/`; copied into `htlc-ui/public/{keys,zkir}/` by the UI's
  `predev` / `prebuild` hook so `FetchZkConfigProvider` resolves them at
  proof time.

### Midnight's dual-ledger model

KAAMOS exercises both ledgers explicitly:

- **Shielded layer** — *authentication and ZK*. The HTLC asserts
  `ownPublicKey().bytes == htlcReceiverAuth` inside the circuit;
  `ZswapCoinPublicKey` is the shielded coin public key (32 raw bytes)
  committed to inside the proof. Bech32m at the wire (`mn_shield-cpk_…`)
  encodes the same bytes.
- **Unshielded layer** — *value movement*. `receiveUnshielded(color,
  amount)` pulls native Zswap coins of an arbitrary `color` into the
  contract; `sendUnshielded(color, amount, payout)` pushes them out to a
  payout `Either<ContractAddress, UserAddress>`.

The split between `htlcReceiverAuth` (shielded `Bytes<32>`) and
`htlcReceiverPayout` (unshielded `Either<…>`) is structural: Compact exposes no
primitive to derive one from the other inside a circuit, so each is provided
explicitly at deposit. The browser bridge (`htlc-ui/src/api/key-encoding.ts`)
decodes the wallet SDK's bech32m strings into the raw bytes the circuit
expects.

## Cardano validators (Aiken)

`cardano/validators/htlc.ak` — datum `{ preimageHash, sender, receiver,
deadline }`; spend redeemer is either `Withdraw{preimage}`
(`signer == receiver`, `upper_bound < deadline`,
`sha2_256(preimage) == preimageHash`) or `Reclaim` (`signer == sender`,
`lower_bound > deadline`). Compiled to Plutus V3 via `aiken build`.

`cardano/validators/usdm.ak` — always-true USDM minting policy (preprod test
token; mainnet would need access control).

## TypeScript layer

Midnight SDK versions in root `package.json` (current preprod-supported
lines):

```
@midnight-ntwrk/compact-runtime           ^0.15.0
@midnight-ntwrk/dapp-connector-api        ^4.0.0
@midnight-ntwrk/midnight-js-contracts     ^4.0.0
@midnight-ntwrk/midnight-js-fetch-zk-config-provider           ^4.0.0
@midnight-ntwrk/midnight-js-indexer-public-data-provider       ^4.0.0
@midnight-ntwrk/midnight-js-level-private-state-provider       ^4.0.0
@midnight-ntwrk/midnight-js-network-id    ^4.0.0
@midnight-ntwrk/midnight-js-http-client-proof-provider         ^4.0.0
@midnight-ntwrk/ledger-v8                 ^8.0.0
@midnight-ntwrk/testkit-js                ^4.0.0
@midnight-ntwrk/wallet-sdk-{facade,dust,shielded,unshielded,…}
```

Type-checking: every workspace defines `typecheck` (`tsc -p tsconfig.json
--noEmit`); the UI build (`tsc && vite build --mode preprod`) fails on type
errors before bundling.

### Error & edge-case handling on the main path

- **Lace `submitTransaction` false-negative.** Lace sometimes throws
  `DAppConnectorAPIError` after the tx has actually landed. `useTakerFlow.
  deposit` and `useReverseMakerFlow.deposit` poll the indexer for up to 60 s
  on submit-throw and verify `receiverAuth` matches the expected key before
  continuing.
- **Blockfrost UTxO-index lag.** `findHTLCUtxo` retries 5 s × 8 attempts; the
  orchestrator gates `cardano-seen` on Blockfrost actually returning the UTxO
  before notifying the counterparty.
- **Stale UTxOs at the shared HTLC script address.** `watchForCardanoLock`
  filters by `(receiverPkh, hashHex, deadline > now)` — three-way, never
  simplified.
- **Cardano slot-floor on reclaim.** `validFrom(posixMs)` floors to the slot
  start; `+1000 ms` offset preserved in CLI + browser drivers so strict
  `>` comparison succeeds.
- **Deadline pre-flight** in `useMakerFlow.claim` surfaces an actionable error
  if the entry is expired or within 60 s of expiry.
- **Orchestrator-as-advisory.** Every poll is wrapped in `tryOrchestrator` and
  falls back to direct indexer queries if the API is down.
- All long-running watchers accept an `AbortSignal`.
- Bech32m / `Bytes<32>` conversion routed through one helper module
  (`key-encoding.ts`) so the wrong-encoding case fails fast.

CLAUDE.md §10 catalogues each landmine and its historical fix.

## Frontend

`htlc-ui/` — React 19 + Vite 7 + MUI 7. Entry point
`htlc-ui/src/main.tsx`:

```
ThemeProvider > ToastProvider > SwapProvider > AuthProvider > App
```

`main.tsx` calls `setNetworkId(import.meta.env.VITE_NETWORK_ID)` from
`@midnight-ntwrk/midnight-js-network-id` at boot. Run scripts:
`npm run dev` (Vite dev server, `http://localhost:5173`),
`npm run build` (typecheck + bundle).

### DApp Connector API integration

`htlc-ui/src/contexts/BrowserHtlcManager.ts` is the wallet bridge:

1. Polls `window.midnight?.[key]` every 100 ms until a Lace API matching
   semver `4.x` appears.
2. Calls `enable()` on the `InitialAPI` from
   `@midnight-ntwrk/dapp-connector-api` to obtain a `ConnectedAPI`.
3. Reads `getConfiguration()`, `getShieldedAddresses()`,
   `getUnshieldedAddress()`, decodes the bech32m payloads into the
   `Bytes<32>` the circuit expects.
4. Returns a `SwapBootstrap` carrying both raw bytes, hex, and bech32m for
   downstream callers.

Cardano wallets (Lace-Cardano / Eternl / Nami / Flint / Typhon) connect via
the standard CIP-30 `window.cardano` interface through
`SwapContext.connectCardano(name?)`.

### End-to-end UI → contract call → state display

A maker locking USDC on Midnight from `/swap`:

1. `SwapCard.tsx` → `useMakerFlow.lock()`.
2. `lock()` calls `HtlcAPI.deposit(...)` with raw `Bytes<32>` from
   `BrowserHtlcManager`'s decoded keys.
3. `HtlcAPI` resolves the deployed contract via `findDeployedContract`
   from `@midnight-ntwrk/midnight-js-contracts`, then submits via
   `deployedContract.callTx.deposit(...)` (proof + tx). See
   `htlc-ui/src/api/htlc-api.ts`.
4. `watchForHTLCDeposit(pub, addr, hashBytes)` polls the indexer's
   public-data provider, reading `htlcAmounts[hash]` until non-zero, then
   resolves `{amount, expiry, color, senderAuth, receiverAuth}` straight
   from contract state.
5. `SwapProgressModal.tsx` advances the step, displays the resolved amount +
   expiry from ledger state, and links to
   `https://explorer.1am.xyz/tx/<hash>?network=preprod`.

The same pattern applies to `withdrawWithPreimage` (preimage round-trip
visible to the UI via `revealedPreimages[hash]`) and to the Cardano
counterpart through `cardano-htlc-browser.ts`.

## Tests

| File                                                                  | Kind                                                                                       |
|-----------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `contract/src/test/sha256-equivalence.test.ts`                        | Vitest unit test: Compact `persistentHash<Bytes<32>>` ≡ Node `createHash('sha256')` ≡ Aiken `sha2_256` (zero, ones, fixed sample, 32 random fuzz). Load-bearing invariant of the swap. |
| `contract/src/test/cardano-htlc-simulator.ts`                         | Pure-TS simulator of the Aiken HTLC validator — exercises Cardano-side circuit logic deterministically without standing up a node. |
| `htlc-ft-cli/src/execute-swap.ts`                                     | End-to-end forward-flow regression against preprod (Cardano lock → Midnight deposit → Midnight withdraw → Cardano withdraw); exercises both real circuits. |

Run: `cd contract && npm test`; CLI regression
`npx tsx htlc-ft-cli/src/execute-swap.ts`.

## Network configuration

Preprod is the primary target. `htlc-ui/.env.preprod` (tracked, no secrets):

```
VITE_NETWORK_ID=preprod
VITE_PROOF_SERVER_URI=http://127.0.0.1:6300
VITE_BLOCKFROST_API_KEY=preprod…
VITE_ORCHESTRATOR_URL=http://localhost:4000
```

Local-network runs swap the indexer / proof-server URLs in the same env file
without code changes. Two additional gitignored env files:

- `htlc-ui/.env.local` — `VITE_SUPABASE_*` (KAAMOS auth).
- `htlc-orchestrator/.env` — `SUPABASE_SERVICE_ROLE_KEY` (server-only; never
  ship to clients).

## Setup

Prereqs: Node 24.11.1+, the Compact compiler (`compact`), Aiken, Lace
(Midnight + Cardano), a local Midnight proof server on `127.0.0.1:6300`, a
Blockfrost preprod project key.

```bash
npm install                                                    # workspaces

cd contract && npm run compact:htlc && npm run compact:usdc \
            && npm run build:all                               # ZK keys + JS
cd ../cardano && aiken build                                   # Plutus V3

# one-time: deploy Midnight HTLC + USDC, write swap-state.json
MIDNIGHT_NETWORK=preprod BLOCKFROST_API_KEY=$BLOCKFROST_API_KEY \
  npx tsx htlc-ft-cli/src/setup-contract.ts
cp htlc-ft-cli/swap-state.json htlc-ui/swap-state.json

cd ../htlc-orchestrator && npm run dev                         # :4000
cd ../htlc-ui           && npm run dev                         # :5173
```

## See also

- `CLAUDE.md` — exhaustive design notes, landmines, KAAMOS OTC layer
  architecture, per-deal wallet-binding model.
- `contract.md` — Compact-side design rationale.
- `deploy.md` — production / hosting notes.

## License

MIT — see `LICENSE`.

---

### Submission checklist evidence

| # | Item                                          | Evidence                                                                                                                                              |
|---|-----------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Compact compiles, non-trivial circuit logic   | `contract/src/{htlc,usdc}.compact`; compiled artefacts under `contract/src/managed/{htlc,usdc}/{compiler,contract,keys,zkir}/`                        |
| 2 | Witnesses / persistent hashes / ZK commitments| `contract/src/witnesses.ts`; `persistentHash<Bytes<32>>` in `htlc.compact:withdrawWithPreimage`; ZK keys + IR in `managed/{htlc,usdc}/{keys,zkir}/`     |
| 3 | Dual-ledger model (shielded vs unshielded)    | `htlcReceiverAuth: Bytes<32>` (shielded) + `htlcReceiverPayout: Either<ContractAddress, UserAddress>` (unshielded); `receiveUnshielded` / `sendUnshielded`; bech32m bridge in `htlc-ui/src/api/key-encoding.ts` |
| 4 | README, setup, GitHub topics                  | This file (sections *Setup* + *Repository layout*); add topics `midnightntwrk` and `compact` to the GitHub repo                                       |
| 5 | Runs on Midnight Preprod or local             | `htlc-ui/.env.preprod` with `VITE_NETWORK_ID=preprod`; `setNetworkId(...)` in `htlc-ui/src/main.tsx`; same env file swaps to local URLs                |
| 6 | Midnight SDK on supported version             | Root `package.json` — `midnight-js-* ^4.0.0`, `compact-runtime ^0.15.0`, `dapp-connector-api ^4.0.0`, `ledger-v8 ^8.0.0`, `testkit-js ^4.0.0`           |
| 7 | Simulation / unit tests on circuit logic      | `contract/src/test/sha256-equivalence.test.ts` (Vitest); `contract/src/test/cardano-htlc-simulator.ts` (pure-TS Aiken simulator)                       |
| 8 | TS compiles cleanly                           | `npm run typecheck` in root + each workspace; `htlc-ui` build runs `tsc` before `vite build`                                                          |
| 9 | TS handles errors / edge cases on main path   | See *Error & edge-case handling on the main path*; CLAUDE.md §10 catalogue                                                                            |
|10 | Functional frontend with entry + run script   | `htlc-ui/src/main.tsx` (`ReactDOM.createRoot(...).render(...)`); `htlc-ui/package.json` `"dev": "vite"`, `"build": "tsc && vite build --mode preprod"` |
|11 | Frontend uses DApp Connector API              | `htlc-ui/src/contexts/BrowserHtlcManager.ts` — `import { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api'`; `window.midnight[key].enable()`     |
|12 | End-to-end UI → contract call → state display | `SwapCard` → `useMakerFlow.lock` → `HtlcAPI.deposit` (`findDeployedContract` + `callTx.deposit` from `midnight-js-contracts`) → `watchForHTLCDeposit` reads `htlcAmounts[hash]` from indexer → `SwapProgressModal` renders state |
