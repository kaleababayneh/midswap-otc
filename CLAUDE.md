# Cross-Chain Atomic Swap: Midnight (USDC) ⇄ Cardano (ADA)

> **Who this document is for.** A frontend-designer Claude session that inherits a working dApp and needs to polish it into a production-ready UI. The protocol, contracts, wallet bootstrap, state machines, observables, and orchestrator are DONE and VERIFIED. Do not rewrite them. Read the "Browser architecture" section, map it to the "Current UI surface", and focus on visual polish, error handling edges, accessibility,, empty states, and production deployment concerns flagged in "Not production-ready yet".

---

## 1. What this project is

A trustless cross-chain atomic swap between **Midnight** (privacy-focused L1) and **Cardano Preprod**. Alice trades ADA for native USDC; Bob trades USDC for ADA. Neither party can cheat — escrow is hash-time-locked on both chains, and if either side times out the funds reclaim to the original sender.

**Two Midnight contracts** (deliberate split):

- `usdc.compact` — pure USD Coin minter over Midnight's native unshielded-token primitives (`mintUnshieldedToken` / `receiveUnshielded` / `sendUnshielded`). No internal ledger — coins live in user wallets as Zswap UTXOs.
- `htlc.compact` — generic, color-parametric hash-time-locked escrow. Pulls coins in on deposit, releases to receiver on `withdrawWithPreimage`, refunds to sender on `reclaimAfterExpiry`. Works with any color, not just USDC.

**One Cardano validator**: `cardano/validators/htlc.ak` (Aiken → Plutus V3). Standard hash-time-lock, off-chain driver via Lucid Evolution.

## 2. Current status (what works)

### Verified end-to-end on preprod

**Two-browser swap, 2026-04-21:** hash `7f6efe70…`. Alice locked ADA in Eternl, shared URL, Bob opened in second browser, deposited USDC via Lace, Alice claimed, Bob claimed. Funds moved correctly on both chains.

**CLI regression (single-process):** `npx tsx htlc-ft-cli/src/execute-swap.ts` — passes.

**CLI two-terminal (preprod):** `alice-swap.ts` + `bob-swap.ts` coordinated via `pending-swap.json` — green.

### What the verification proves

- Contract split (htlc + usdc) is load-bearing-correct.
- Native unshielded coin I/O (`receiveUnshielded` / `sendUnshielded`) works in circuit + balances correctly against wallet UTXOs.
- `revealedPreimages` reveal-and-read mechanism lets Bob learn the preimage from Midnight and claim Cardano.
- Cardano `validFrom` slot-alignment fix (`+1000ms`) unblocks the reclaim path.
- Browser wallet integration via `@midnight-ntwrk/dapp-connector-api` (Lace/1AM) + CIP-30 (Eternl) both work.
- bech32m → Bytes<32> decoding via `@midnight-ntwrk/wallet-sdk-address-format` fixes the "Only designated receiver" bug (Landmine #1, see §11).

### The "what's next" for you

The behavior is complete. The UI is functional. Your job is to make it feel like a product people would trust to move real money through (even if the money here is preprod tADA and test USDC). See §12.

## 3. Repo layout

```
example-bboard/
├── CLAUDE.md                                   ← you are here
├── contract/                                   ← Midnight smart contracts (Compact)
│   └── src/
│       ├── htlc.compact                        ← generic HTLC escrow
│       ├── usdc.compact                        ← USDC minter
│       ├── htlc-contract.ts                    ← TS wrapper exposing CompiledHTLCContract
│       ├── usdc-contract.ts                    ← TS wrapper exposing CompiledUSDCContract
│       └── managed/
│           ├── htlc/                           ← compiled: keys/, zkir/, contract/index.d.ts
│           └── usdc/                           ← compiled: keys/, zkir/, contract/index.d.ts
│
├── cardano/                                    ← Aiken validator
│   ├── validators/htlc.ak
│   └── plutus.json                             ← compiled blueprint (copied into htlc-ui/public)
│
├── htlc-ft-cli/                                ← reference CLI implementation (behavioral spec)
│   └── src/
│       ├── execute-swap.ts                     ← single-process regression
│       ├── alice-swap.ts / bob-swap.ts         ← two-terminal flow (reference for UI state machines)
│       ├── reclaim-ada.ts / reclaim-usdc.ts    ← refund paths
│       ├── setup-contract.ts                   ← deploys both contracts, mints seed USDC
│       ├── mint-usdc.ts                        ← mint more USDC after setup
│       ├── midnight-watcher.ts                 ← polls indexer (deposits + revealedPreimages)
│       ├── cardano-watcher.ts                  ← polls Blockfrost (HTLC UTxOs, filter by PKH + hash)
│       ├── cardano-htlc.ts                     ← Lucid Evolution driver for the Aiken validator
│       ├── midnight-wallet-provider.ts         ← CLI-only seed wallet (browser uses dapp-connector-api)
│       ├── config.ts                           ← MIDNIGHT_NETWORK=preprod|undeployed switch
│       └── …
│
├── htlc-ui/                                    ← THE frontend (the thing you are polishing)
│   ├── public/
│   │   ├── keys/                               ← populated by predev (htlc + usdc prover/verifier keys)
│   │   ├── zkir/                               ← populated by predev (htlc + usdc zkir)
│   │   └── plutus.json                         ← populated by predev (Cardano blueprint)
│   ├── src/
│   │   ├── main.tsx                            ← CssBaseline + Theme + Toast + Swap providers
│   │   ├── App.tsx                             ← BrowserRouter + 8 routes
│   │   ├── globals.ts                          ← Buffer / process polyfills (keep as-is)
│   │   ├── vite-env.d.ts
│   │   ├── swap-state.json                     ← contract addresses + usdcColor (copy of htlc-ft-cli's)
│   │   ├── in-memory-private-state-provider.ts ← per-contract private-state cache
│   │   ├── config/
│   │   │   ├── theme.ts                        ← MUI dark theme (midnightGrey primary)
│   │   │   └── limits.ts                       ← runtime-configurable safety windows (env-overridable)
│   │   ├── api/
│   │   │   ├── common-types.ts                 ← HTLCProviders, USDCProviders, HTLCEntry, derived state
│   │   │   ├── key-encoding.ts                 ← bech32m ↔ Bytes<32>, userEither() helper
│   │   │   ├── htlc-api.ts                     ← HtlcAPI (state$ + deposit/withdraw/reclaim)
│   │   │   ├── usdc-api.ts                     ← UsdcAPI (state$ + mint)
│   │   │   ├── cardano-htlc-browser.ts         ← CardanoHTLCBrowser (CIP-30 version of cardano-htlc.ts)
│   │   │   ├── midnight-watcher.ts             ← watchForHTLCDeposit / watchForPreimageReveal
│   │   │   ├── cardano-watcher.ts              ← watchForCardanoLock / waitForCardanoHTLCConsumed
│   │   │   └── orchestrator-client.ts          ← typed REST client for htlc-orchestrator
│   │   ├── contexts/
│   │   │   ├── BrowserHtlcManager.ts           ← wallet bootstrap (Lace semver check + decoded keys)
│   │   │   ├── SwapContext.tsx                 ← Midnight + Cardano session state
│   │   │   ├── ToastContext.tsx                ← app-wide Snackbar queue
│   │   │   └── index.ts
│   │   ├── hooks/
│   │   │   ├── useSwapContext.ts
│   │   │   ├── useToast.ts
│   │   │   └── index.ts
│   │   └── components/
│   │       ├── Layout/{MainLayout,Header,index}.tsx
│   │       ├── Landing.tsx                     ← role picker + deployed-contract info
│   │       ├── WalletConnect.tsx               ← dual-wallet connect card
│   │       ├── WalletGate.tsx                  ← "install extension" gate for pages that need wallets
│   │       ├── AliceSwap.tsx                   ← Alice state machine (9 steps)
│   │       ├── BobSwap.tsx                     ← Bob state machine (11 steps)
│   │       ├── Browse.tsx                      ← discover open offers (polls orchestrator)
│   │       ├── Reclaim.tsx                     ← list-driven + manual-by-hash refund
│   │       ├── MintUsdc.tsx                    ← self-serve mint (calls USDC contract)
│   │       ├── Dashboard.tsx                   ← observability over all orchestrator swaps
│   │       ├── HowTo.tsx                       ← plain-prose protocol explainer
│   │       ├── ShareUrlCard.tsx                ← QR + copy + native share (navigator.share)
│   │       ├── SwapStatusChip.tsx              ← unified status vocabulary
│   │       ├── AsyncButton.tsx                 ← spinner + "check your wallet" hint
│   │       ├── RecoveryBanner.tsx              ← global banner if user has reclaimable swaps
│   │       └── index.ts
│   ├── .env.preprod                            ← VITE_NETWORK_ID + proof server + Blockfrost key
│   ├── index.html
│   ├── package.json                            ← predev copies keys/zkir/plutus.json into public/
│   └── vite.config.ts
│
└── htlc-orchestrator/                          ← advisory backend (enhances UX, never authoritative)
    └── src/
        ├── server.ts                           ← Fastify + CORS + routes + watchers
        ├── db.ts                               ← better-sqlite3 WAL-mode store
        ├── schema.sql
        ├── types.ts                            ← Swap, SwapStatus, CreateSwapBody, PatchSwapBody
        ├── routes/swaps.ts                     ← POST/GET/PATCH /api/swaps
        ├── midnight-watcher.ts                 ← indexer poller → status transitions
        ├── cardano-watcher.ts                  ← Blockfrost poller → status transitions
        └── stuck-alerter.ts                    ← Slack/Discord/raw-JSON webhook (opt-in)
```

Legacy scaffolding still present (DO NOT delete — reference material only):
- `api/` — old BBoard API layer (template that `HtlcAPI` / `UsdcAPI` copy from).


## 4. The HTLC contract (generic escrow)

**File:** `contract/src/htlc.compact` · **Compiled TS surface:** `contract/src/managed/htlc/contract/index.d.ts`

### Circuits

```typescript
// Lock: pulls `amount` coins of `color` from caller (receiveUnshielded),
//       records the whole record keyed by `hash`.
deposit(args): []

// Claim: caller's ownPublicKey must match receiverAuth; preimage is persisted
//        in revealedPreimages[hash] so the other chain can read it;
//        coins go to receiverPayout; amount sentinel set to 0.
withdrawWithPreimage(arg): []

// Refund after deadline: caller must match senderAuth; coins go to senderPayout.
reclaimAfterExpiry(arg): []
```

### Ledger (all `export ledger`, indexer-queryable)

```typescript
htlcAmounts:        Map<Bytes<32>, Uint<128>>        // 0 = completed sentinel
htlcExpiries:       Map<Bytes<32>, Uint<64>>         // seconds since epoch
htlcColors:         Map<Bytes<32>, Bytes<32>>
htlcSenderAuth:     Map<Bytes<32>, Bytes<32>>        // ZswapCoinPublicKey.bytes
htlcReceiverAuth:   Map<Bytes<32>, Bytes<32>>
htlcSenderPayout:   Map<Bytes<32>, Either<ContractAddress, UserAddress>>
htlcReceiverPayout: Map<Bytes<32>, Either<ContractAddress, UserAddress>>
revealedPreimages:  Map<Bytes<32>, Bytes<32>>        // populated by withdrawWithPreimage
```

Compact maps have no `delete` — sentinel values (amount=0) mark completion. **Auth** (receiver/sender key checked in circuit) and **payout** (destination address) are stored separately because Compact cannot derive one from the other inside a circuit.

## 5. The USDC contract (native-token minter)

**File:** `contract/src/usdc.compact` · **Compiled TS surface:** `contract/src/managed/usdc/contract/index.d.ts`

### Circuits

```typescript
mint(recipient: Either<ContractAddress, UserAddress>, amount: Uint<64>): []
// First call captures _color via mintUnshieldedToken(domainSep, amount, recipient).
// Subsequent calls mint more of that same color.
name(): Opaque<"string">
symbol(): Opaque<"string">
decimals(): Uint<8>
color(): Bytes<32>
```

### Ledger

```typescript
_name:       Opaque<"string">  (sealed — constructor)
_symbol:     Opaque<"string">  (sealed — constructor)
_decimals:   Uint<8>           (sealed — constructor)
_domainSep:  Bytes<32>         (sealed — constructor)
_color:      Bytes<32>         (NOT sealed — set on first mint)
```

No on-chain balance map; USDC lives as native unshielded UTXOs in holders' Zswap wallets, exactly analogous to how ADA lives in Cardano UTxOs.

**Security note for UI:** `mint()` currently has **no access control** — anyone connected can mint arbitrary USDC. This is fine for preprod demos but is something production gating (or an RBAC wrapper contract) would need to address. The `/mint-usdc` page is advertised as a convenience for people who want to test Bob's role.

## 6. The Cardano HTLC (Aiken validator)

**File:** `cardano/validators/htlc.ak` · **Compiled:** `cardano/plutus.json` (copied into `htlc-ui/public/plutus.json` by predev)

PlutusV3 spending validator:

- **Datum:** `{ preimageHash, sender (PKH), receiver (PKH), deadline (POSIX ms) }`
- **Redeemer:** `Withdraw { preimage }` | `Reclaim`
- **Withdraw:** `sha256(preimage) == datum.preimageHash` AND `upper_bound < deadline` AND signer = receiver
- **Reclaim:** `lower_bound > deadline` (strict) AND signer = sender

### The validFrom slot-alignment landmine (reclaim path)

On Preprod (1 slot = 1 s), `validFrom(posixMs)` floors to the slot's POSIX start. If `posixMs == deadline`, the tx's `lower_bound` equals `deadline`, and the Aiken check `lower_bound > deadline` fails strictly. **Fix:** offset `+1000ms` past the deadline before setting `validFrom`. Implemented in both `htlc-ft-cli/src/cardano-htlc.ts::reclaim()` and `htlc-ui/src/api/cardano-htlc-browser.ts::reclaim()`. Leave this alone.

## 7. The atomic swap protocol (what the UI is orchestrating)

```
Alice has ADA on Cardano, wants native USDC on Midnight.
Bob has native USDC on Midnight, wants ADA on Cardano.

STEP 1.  Alice generates a random 32-byte PREIMAGE → HASH = SHA256(PREIMAGE).
STEP 2.  Alice locks ADA on Cardano HTLC:
            datum = { hash, sender=alice, receiver=bob, deadline=now+~2h }
         Alice publishes a share URL to Bob (hash, her Zswap coinPublicKey,
                                             her unshielded address, deadline,
                                             amounts).
STEP 3.  Bob watches Cardano, finds Alice's lock by hash, validates deadline
         safety, then deposits native USDC on Midnight HTLC:
            deposit(
              color=usdcColor, amount, hash,
              expiryTime = Bob-deadline < Alice-deadline - safety-buffer,
              receiverAuth=alice's Zswap coinPublicKey bytes,
              receiverPayout=alice's unshielded address,
              senderPayout=bob's unshielded address,
            )
STEP 4.  Alice claims USDC on Midnight:
            withdrawWithPreimage(PREIMAGE)
         This reveals PREIMAGE in revealedPreimages[hash] AND passes the
         ownPublicKey().bytes == htlcReceiverAuth assertion.
STEP 5.  Bob reads PREIMAGE from Midnight's revealedPreimages[hash].
STEP 6.  Bob claims ADA on Cardano with PREIMAGE.
         Cardano validator checks sha256(PREIMAGE) == datum.preimageHash.

Failure paths (reclaim):
  - Alice's ADA on Cardano after deadline → reclaim-ada.ts / Reclaim.tsx.
  - Bob's USDC on Midnight after deadline → reclaim-usdc.ts / Reclaim.tsx.
```

Chain state is the source of truth. The orchestrator's SQLite DB is a **view** for discovery/UX; it is never used to authorize a swap step.

## 8. Browser architecture (`htlc-ui/`)

### Bootstrap order (`main.tsx`)

```
<CssBaseline />
<ThemeProvider theme={theme}>             ← src/config/theme.ts
  <ToastProvider>                         ← src/contexts/ToastContext.tsx
    <SwapProvider logger={logger}>        ← src/contexts/SwapContext.tsx
      <App />
    </SwapProvider>
  </ToastProvider>
</ThemeProvider>
```

`App.tsx` mounts `<MainLayout>` (Header + RecoveryBanner + Container) and 8 routes:

| Path         | Component       | Purpose                                             |
|--------------|-----------------|-----------------------------------------------------|
| `/`          | `Landing`       | Role picker, deployed-contract info, getting-started |
| `/alice`     | `AliceSwap`     | Alice state machine (lock → share → wait → claim)   |
| `/bob`       | `BobSwap`       | Bob state machine (watch → deposit → wait → claim)  |
| `/browse`    | `Browse`        | Discover open offers (filtered by Bob PKH)          |
| `/reclaim`   | `Reclaim`       | Recover stuck funds                                 |
| `/mint-usdc` | `MintUsdc`      | Self-serve USDC mint to get Bob started             |
| `/dashboard` | `Dashboard`     | All swaps the orchestrator knows about              |
| `/how-to`    | `HowTo`         | Plain-prose protocol explainer                      |
| `*`          | → `/`           | catch-all                                           |

### The provider chain

**`BrowserHtlcManager.ts`** — the hardest-to-rederive code. Bootstraps everything for a given connected wallet:

1. Polls `window.midnight?.[key]` every 100 ms (RxJS `interval(100) / timeout(5000)`) until a Lace-compatible API appears. Filters by semver (`COMPATIBLE_CONNECTOR_API_VERSION = '4.x'`).
2. Calls `initialAPI.enable()` → `connectedAPI`.
3. Fetches `getConfiguration()`, `getShieldedAddresses()`, `getUnshieldedAddress()`.
4. **Decodes bech32m → Bytes<32>** via `src/api/key-encoding.ts` (the Landmine #1 fix — do NOT remove this; see §11).
5. Builds two provider bundles: `HTLCProviders` and `USDCProviders`. Shares `publicDataProvider`, `walletProvider`, `midnightProvider`, `proofProvider` across both; each gets its own `inMemoryPrivateStateProvider`.
6. Returns `SwapBootstrap { networkId, htlcProviders, usdcProviders, coinPublicKey{Bytes,Hex,Bech32m}, unshieldedAddress{Bytes,Hex,Bech32m}, connectedAPI }`.

**`SwapContext.tsx`** — React context around the bootstrap. Exposes:

```typescript
interface SwapContextValue {
  session?: SwapSession;                   // { bootstrap, htlcApi, usdcApi }
  cardanoSession?: CardanoSession;          // { cardanoHtlc, paymentKeyHash, address, api }
  connectMidnight(): Promise<SwapSession>;  // idempotent; joins both contracts
  connectCardano(walletName?): Promise<CardanoSession>;  // CIP-30 enable + Lucid selectWallet.fromAPI
  disconnectMidnight(): void;
  disconnectCardano(): void;
  // flags: midnightConnecting, cardanoConnecting, midnightError, cardanoError
}
```

Separate inflight promises prevent double-connect races. Both connect calls are idempotent.

**`HtlcAPI` and `UsdcAPI`** (in `src/api/`) — mirror the old `BBoardAPI` pattern:

```typescript
class HtlcAPI {
  private constructor(
    private readonly providers: HTLCProviders,
    private readonly deployedContract: DeployedHTLCContract,
    private readonly logger: Logger,
  ) {}

  readonly state$: Observable<HTLCDerivedState>;   // derived via publicDataProvider.contractStateObservable

  deposit(params: DepositParams): Promise<FinalizedTxData>
  withdrawWithPreimage(preimage: Uint8Array): Promise<FinalizedTxData>
  reclaimAfterExpiry(hash: Uint8Array): Promise<FinalizedTxData>

  static async join(providers: HTLCProviders, address: ContractAddress, logger: Logger): Promise<HtlcAPI>
}
```

`HTLCDerivedState.entries` is a `ReadonlyMap<string, HTLCEntry>` keyed by hex hash.

### Watchers

All polling watchers live in `src/api/` and accept `AbortSignal` for cancellation:

- **`watchForHTLCDeposit(publicDataProvider, htlcAddr, hashLockBytes, pollMs=5000, signal?)`** → `{ amount, expiry, color, senderAuth, receiverAuth }`. Resolves when `htlcAmounts[hash] > 0n`.
- **`watchForPreimageReveal(publicDataProvider, htlcAddr, hashLockBytes, pollMs=5000, signal?)`** → `Uint8Array`. Resolves when `revealedPreimages[hash]` is populated.
- **`watchForCardanoLock(cardanoHtlc, receiverPkh?, pollMs=10_000, hashHex?, signal?)`** → `{ hashHex, amountLovelace, deadlineMs, senderPkh, receiverPkh }`. **Filters by receiver PKH + specific hash + freshness (`deadline > now`)** — without this triple filter, Bob latches onto stale UTxOs at the shared script address (see §11).
- **`waitForCardanoHTLCConsumed(…)`** — follow-up watcher used to confirm a claim/reclaim hit the chain.

### State-machine components

Both role components are `useReducer`-driven state machines. **Do not replace `useReducer` with Redux / Zustand / etc.** — the whole protocol fits in ~10 states and the reducer is easy to audit.

**`AliceSwap.tsx`** — 9 states: `connect | params | locking | locked | waiting-deposit | claim-ready | claiming | done | error`.

- Generates random 32-byte preimage (`crypto.getRandomValues`) and hashes it (`crypto.subtle.digest('SHA-256', …)`).
- Locks ADA via `cardanoHtlc.lock(lovelace, hashHex, bobPkh, deadlineMs)`.
- **Persists pending swap in `localStorage`** under `htlc-ui:alice-pending-swap:<hash>` (preimage + hash + deadline + amounts) so a page refresh doesn't lose the preimage. Trade-off: preimage in `localStorage` is not great for a prod app but the alternative — losing the preimage mid-swap — is worse.
- Shares a URL built from `URLSearchParams`: `?role=bob&hash=…&aliceCpk=…&aliceUnshielded=…&cardanoDeadlineMs=…&adaAmount=…&usdcAmount=…`.
- **Dual-path deposit detection** during wait: Midnight indexer (via `session.htlcApi.state$`) **AND** orchestrator poll (every 2 s). First signal wins. The orchestrator path is usually ~5 s faster but is advisory — chain state still has to confirm.
- On claim, calls `session.htlcApi.withdrawWithPreimage(preimage)`.

**`BobSwap.tsx`** — 11 states: `need-url | connect | watching-cardano | confirm | unsafe-deadline | depositing | waiting-preimage | claim-ready | claiming | done | error`.

- Reads URL params; if missing, routes to `need-url`.
- Watches Cardano for Alice's lock (filters by Bob's own PKH + hash).
- Safety checks (from `src/config/limits.ts`):
  - `cardanoRemaining < limits.bobMinCardanoWindowSecs` → `unsafe-deadline`
  - `bobTtlSecs < limits.bobMinDepositTtlSecs` after safety-buffer truncation → `unsafe-deadline`
- Deposit call passes Alice's decoded bytes (`receiverAuth`, `receiverPayout`) and Bob's own unshielded address (`senderPayout`).
- Waits on preimage via Midnight watcher **OR** orchestrator poll (same race pattern as Alice).
- Claims ADA via `cardanoHtlc.claim(preimageHex)`.

All long-running operations wrap user actions in `<AsyncButton>` so the button disables + spins + surfaces "check your wallet" after `limits.walletPopupHintMs`.

### bech32m encoding helpers (`src/api/key-encoding.ts`)

```typescript
decodeShieldedCoinPublicKey(bech32: string, networkId: NetworkId): Uint8Array  // 32 bytes
encodeShieldedCoinPublicKey(bytes: Uint8Array, networkId: NetworkId): string   // round-trip
decodeUnshieldedAddress(bech32: string, networkId: NetworkId): Uint8Array
encodeUnshieldedAddress(bytes: Uint8Array, networkId: NetworkId): string
userEither(addrBytes: Uint8Array): Either<ContractAddress, UserAddress>
  // { is_left: false, left: { bytes: zeros32 }, right: { bytes: addrBytes } }
```

Backed by `@midnight-ntwrk/wallet-sdk-address-format`. **Every HTLC deposit must go through `decodeShieldedCoinPublicKey` for `receiverAuth` and `decodeUnshieldedAddress` + `userEither` for `receiverPayout` / `senderPayout`.** The CLI learned this the hard way; the browser inherits the fix.

## 9. Design system (MUI)

**Theme** (`src/config/theme.ts`):

- Dark mode; primary = `midnightGrey.500` (#808090 range).
- Background = `#464655` (single flat tone — no elevation layering).
- Typography = Helvetica, all-white; MUI defaults for sizes.
- MUI 7, React 19, react-router 7.13.

**Shared components** (reuse these, don't reinvent):

- **`<AsyncButton onClick={asyncFn} pendingLabel="Working…" walletHint="Check your wallet…">`** — spinner + disable + hint. `walletHint` appears after `limits.walletPopupHintMs` (default 3 s).
- **`<WalletGate require={{ midnight: true, cardano: false }} title="…" intro="…">`** — detects missing Lace / Eternl, surfaces install links, blocks children until wallets are connected. Use on every page whose main content requires a wallet.
- **`<SwapStatusChip status="bob_deposited" />`** — unified vocabulary. Do not introduce new severities or labels for statuses without updating this component.
- **`<ShareUrlCard url={…} />`** — QR (168 px, ECC level M via `qrcode.react`) + copy + `navigator.share`. Used by `AliceSwap` after locking.
- **`<RecoveryBanner />`** (in `MainLayout`) — polls orchestrator every 20 s; if connected wallet has reclaimable swaps, shows a dismissable banner linking to `/reclaim`.
- **Toast via `useToast()`** — `success(msg) / info(msg) / warning(msg) / error(msg)`. Single `<Snackbar>` + queue. Default durations: success/info 3.5 s, warning 6 s, error 8 s. Use for wallet errors, "copied to clipboard", network blips, orchestrator 5xx.

**Runtime config (`src/config/limits.ts`):**

```typescript
aliceMinDeadlineMin     = VITE_ALICE_MIN_DEADLINE_MIN     ?? 3       // floor
aliceDefaultDeadlineMin = VITE_ALICE_DEFAULT_DEADLINE_MIN ?? 120
bobMinCardanoWindowSecs = VITE_BOB_MIN_CARDANO_WINDOW_SECS ?? 180
bobSafetyBufferSecs     = VITE_BOB_SAFETY_BUFFER_SECS     ?? 60
bobDeadlineMin          = VITE_BOB_DEADLINE_MIN           ?? 2
bobMinDepositTtlSecs    = VITE_BOB_MIN_DEPOSIT_TTL_SECS   ?? 60
browseMinRemainingSecs  = VITE_BROWSE_MIN_REMAINING_SECS  ?? 180
walletPopupHintMs       = VITE_WALLET_POPUP_HINT_MS       ?? 3000
```

These are INTENTIONALLY short — a demo needs 2-minute expiries to be testable. For mainnet / real money, the frontend would read longer values. Override with `VITE_*` env vars; do **not** inline new hardcoded numbers in components.

## 10. The orchestrator (advisory)

`htlc-orchestrator/` is a Fastify + SQLite service that:

1. **Indexes swaps** — Alice POSTs to `/api/swaps` right after locking. The UI lets Bob discover offers via `GET /api/swaps?status=open`, which is what `/browse` reads.
2. **Fast-path events** — both role components poll the orchestrator in parallel with the Midnight indexer. Whichever sees the transition first wins. This cuts ~5 s off each wait step (orchestrator polls indexer every 5 s with a hot connection; in-browser indexer calls are cold).
3. **Watchers maintain status** — `midnight-watcher.ts` transitions `open→bob_deposited` when deposit appears on-chain, `bob_deposited→alice_claimed` when preimage is revealed, `bob_deposited→bob_reclaimed` on refund. `cardano-watcher.ts` transitions `alice_claimed→completed` when lock UTxO is spent, and `open|bob_deposited→alice_reclaimed` on post-deadline spend.
4. **Stuck-swap alerter** (opt-in) — posts to `STUCK_SWAP_WEBHOOK_URL` (auto-detects Slack vs Discord vs raw JSON) when reclaim is available or a claim has stalled > 15 min.

**Authority model.** The orchestrator is a **view**. Contracts are authoritative. If the orchestrator is down, both `/alice` and `/bob` still work — they just fall back to the Midnight indexer (slower). If the orchestrator DB disagrees with chain state, chain state wins; `tryOrchestrator()` in `orchestrator-client.ts` swallows errors and logs them.

**REST API:**
```
POST   /api/swaps            CreateSwapBody → Swap   (409 if hash exists)
GET    /api/swaps?status=X   → { swaps: Swap[] }
GET    /api/swaps/:hash      → Swap
PATCH  /api/swaps/:hash      PatchSwapBody → Swap
GET    /health               → { ok, db }
```

Input validation is regex-based (hash 64 hex chars, amounts non-negative bigint strings, status union). CORS allows `localhost:5199`, `localhost:5173`, `localhost:8080`.

## 11. Known incidents and gotchas

### Landmine #1: bech32m ↔ Bytes<32> — RESOLVED

**Symptom (CLI, pre-fix):** Alice's `withdrawWithPreimage` always failed with `Only designated receiver can withdraw`.

**Root cause:** Bob was passing a bech32m-encoded string or the wrong HD-role key as `receiverAuth`. The circuit compares against `ownPublicKey().bytes` which is raw 32 bytes derived from the Zswap shielded role.

**Fix (browser):** `BrowserHtlcManager` always decodes via `decodeShieldedCoinPublicKey(bech32, networkId) → Uint8Array` and the decoded bytes are what gets passed to `deposit(..., receiverAuth, ...)`. Similarly for `receiverPayout` / `senderPayout`, which use `decodeUnshieldedAddress + userEither`.

**What you must not do:**
- Do not pass `connectedAPI.zswapCoinPublicKey` (a bech32m string) as `receiverAuth`.
- Do not grab the old CLI `address.json.alice.midnight.coinPublicKey` field — that was the Night (unshielded) key mis-named as `coinPublicKey`.
- Always source auth / payout from `BrowserHtlcManager` (decoded) or from `key-encoding.ts`.

### Landmine #2: stale Cardano UTxOs at the shared script address

The Cardano HTLC script address is shared across all swaps (it's just the validator's script hash). Preprod has accumulated ~6 stale UTxOs from prior test runs. `watchForCardanoLock` **must** filter by `(receiverPkh, hashHex, deadline > now)` — all three. No-filter watchers latch onto unrelated UTxOs and corrupt the swap.

`BobSwap.tsx` already passes the hash it got from the URL, so this is handled. Do not "simplify" the watcher signature.

### Landmine #3: ZK asset hosting

`FetchZkConfigProvider` fetches `${origin}/keys/<circuit>.{prover,verifier}` and `${origin}/zkir/<circuit>.bzkir` over HTTP. The Vite dev server serves `public/` at root, so the `predev` hook in `htlc-ui/package.json` populates `public/keys/` + `public/zkir/` from `contract/src/managed/{htlc,usdc}/{keys,zkir}/` on every `npm run dev` or `npm run build`. Circuit names do not collide (HTLC: `deposit/withdrawWithPreimage/reclaimAfterExpiry`; USDC: `mint/name/symbol/decimals/color`) so a flat merge works.

If you see `fetch /keys/…prover 404` in the console, the predev hook didn't run — do a clean `npm install && npm run dev` to retrigger.

### Landmine #4: deadline-floor bug (fixed)

Earlier BobSwap passed its Midnight deadline as `Math.floor(Date.now() / 1000) + bobDeadlineMin * 60`. If that was very tight against Alice's Cardano deadline, the safety-buffer truncation could pull the TTL to zero or negative. Fix: `limits.bobMinDepositTtlSecs` is a hard floor; if the post-truncation TTL is lower, BobSwap enters `unsafe-deadline` and aborts with a specific error message showing the seconds. Don't re-introduce a hardcoded minimum in the component.

### Gotcha: Compact map semantics

Midnight Compact maps have no delete. A completed swap is marked by `htlcAmounts[hash] = 0`. `state$` derivation code treats `0n` as "completed, don't surface to user as active offer"; treat it the same in any new UI code.

### Gotcha: multiple Lace / Eternl APIs

`window.cardano` can have 3-5 entries (Eternl, Nami, Lace-Cardano, etc.). `SwapContext.connectCardano(walletName?)` accepts an optional wallet name; default prefers `'eternl'` if present, else first available. If users install a new Cardano wallet post-connection, they need to disconnect+reconnect.

### Gotcha: Blockfrost key is in the client bundle

`VITE_BLOCKFROST_API_KEY` ships to every user. This is fine for a preprod demo (rate-limited key, no value at stake), **not fine for mainnet**. Migration path for production: proxy Blockfrost calls through a small backend that adds the header server-side.

## 12. Not production-ready yet (your scope)

These are the known gaps between "it works" and "a stranger would trust it with real money." Prioritize user-visible things first.

### A. UX polish

- **Empty states.** `/browse` with zero open offers just shows blank space. Needs a friendly "no open offers — tell a friend to start one" state with a link to `/alice`. Same for `/dashboard` and `/reclaim` when there's nothing to show.
- **Loading skeletons.** Swap tables and state cards currently pop in. MUI `<Skeleton>` for the first render would be nicer.
- **Error copy.** Most catch blocks surface raw `e.message`. A mapping layer ("user rejected in wallet" / "insufficient ADA" / "orchestrator offline, falling back to indexer") would help. Group errors by category and show a recovery suggestion.
- **Success confirmation.** After a swap completes, the "done" state is a small card. Consider a celebration state with a share-to-social call-out — atomic-swap completions are rare and demo-able.
- **Transaction links.** `Dashboard` already links to Midnight indexer + cardanoscan.io/preprod; make sure every tx-bearing card (Alice lock, Bob deposit, both claims, both reclaims) does the same.




### D. Production deployment concerns

- **Blockfrost key in client bundle** — documented above; proxy via backend for mainnet.
- **Bundle size** — `@midnight-ntwrk/*` + `@lucid-evolution/lucid` + MUI + qrcode.react is heavy. `npm run build` has not been optimized (no route-level code splitting, no tree-shake audit).
- **Orchestrator single-instance** — `better-sqlite3` with a local file. Fine for one box; horizontal scaling would need a real DB (Postgres) and a leader for the watchers (or move watchers to a separate worker).
- **CORS origins** — orchestrator currently allows `localhost:{5199,5173,8080}`. Production domain has to be added to `server.ts`.
- **USDC mint has no access control** — currently anyone connected can call `mint()`. The `/mint-usdc` page openly advertises this. For a real demo this is OK-and-labeled; for production you would wrap this in an auth-gated contract (or a backend that holds the mint key and rate-limits).
- **Preimage in `localStorage`** — Alice's in-progress preimage is persisted so refresh doesn't lose it. Per-origin, not encrypted. A real app would encrypt with a wallet-derived key or use session storage + warn the user not to refresh.

### E. Missing wallet affordances

- No "disconnect wallet" flow for either chain beyond `SwapContext.disconnect*` (not wired to a UI button).
- No wallet-balance live updates — balances poll every 30 s in Header, don't refresh after a tx. Subscribe to `walletProvider.balances$` if the SDK exposes it.
- No wallet-switching UI — if the user changes account in Lace, the UI won't notice until reload.

### F. Things to explicitly NOT change

- **State machines** (`useReducer` in `AliceSwap`, `BobSwap`) — they mirror the CLI reference exactly. Refactoring for cleanliness will drop invariants. Add features by adding states, not by restructuring.
- **`BrowserHtlcManager` wallet-polling + semver check** — this is the only way to coexist with Lace's version churn. Do not replace with a direct `window.midnight.x` grab.
- **bech32m decoding pipeline in `key-encoding.ts`** — Landmine #1. Do not bypass for any reason.
- **Safety checks in `BobSwap`** (`limits.bobMinCardanoWindowSecs`, `limits.bobSafetyBufferSecs`, `limits.bobMinDepositTtlSecs`) — these protect Bob from a "lowballed deadline" race. Tune via `VITE_*` env vars, don't remove the checks.
- **Orchestrator-as-advisory model** — keep chain state authoritative. Never gate a user action on orchestrator response; always `tryOrchestrator()` + fall back to indexer.
- **The contract split** — htlc + usdc are separate on purpose. Don't join them.

## 13. Running it

### Prereqs

- Cardano Preprod Blockfrost key in `htlc-ui/.env.preprod` as `VITE_BLOCKFROST_API_KEY=…`.
- Midnight local proof server at `127.0.0.1:6300` (`docker run …` — see Midnight docs).
- Midnight preprod endpoints reachable (no VPN / corp firewall issues).
- Lace (Midnight) + Eternl (Cardano) browser extensions installed.
- Both wallets funded: Midnight via https://faucet.preprod.midnight.network/ (dust auto-generates, ~15 min sync first time); Cardano via preprod faucet.

### First-time setup

```bash
# 1. Compile contracts + build workspace packages
cd contract
npm run compact:htlc
npm run compact:usdc
npm run build:all

# 2. Deploy both contracts + mint seed USDC + write swap-state.json
cd ../htlc-ft-cli
MIDNIGHT_NETWORK=preprod npx tsx src/setup-contract.ts

# 3. Copy the fresh swap-state.json into the UI
cp swap-state.json ../htlc-ui/swap-state.json

# 4. Start the orchestrator (optional but recommended — enables /browse + fast-path)
cd ../htlc-orchestrator
npm install
SWAP_STATE_PATH=../htlc-ft-cli/swap-state.json \
  BLOCKFROST_API_KEY=$BLOCKFROST_API_KEY \
  npm run dev         # default port 4000

# 5. Start the UI
cd ../htlc-ui
npm install
npm run dev           # default port 5173
```

### Two-browser end-to-end

- Browser A (Alice): navigate to `http://localhost:5173/alice`, connect Lace + Eternl, fill amounts, lock ADA, copy share URL.
- Browser B (Bob): navigate to the share URL (or `http://localhost:5173/bob` if you want to paste the URL on the page), connect wallets, accept, deposit USDC.
- Browser A (Alice): "Claim USDC" button lights up within ~5 s, click, sign.
- Browser B (Bob): "Claim ADA" button lights up, click, sign.
- Both wallets reflect the swap.

### CLI regression (sanity check)

```bash
cd htlc-ft-cli
npx tsx src/execute-swap.ts          # single-process regression
npx tsx src/smoke-native.ts          # Midnight-only smoke (deposit + reclaim)
npx tsx src/smoke-cardano-reclaim.ts # Cardano-only smoke (lock + reclaim)
```

Two-terminal on preprod: `MIDNIGHT_NETWORK=preprod npx tsx src/alice-swap.ts` in one terminal, then `MIDNIGHT_NETWORK=preprod npx tsx src/bob-swap.ts` in the other AFTER Alice logs "Published hash to pending-swap.json".

## 14. Key files to read first (for the frontend-designer session)

In order of "stop and read this before you change anything":

1. `htlc-ui/src/contexts/BrowserHtlcManager.ts` — how wallets + contracts are wired.
2. `htlc-ui/src/contexts/SwapContext.tsx` — the React-visible surface.
3. `htlc-ui/src/components/AliceSwap.tsx` — Alice state machine (copy patterns from here, don't refactor).
4. `htlc-ui/src/components/BobSwap.tsx` — Bob state machine + safety checks.
5. `htlc-ui/src/api/key-encoding.ts` — bech32m → Bytes<32> (Landmine #1 fix).
6. `htlc-ui/src/api/htlc-api.ts` + `usdc-api.ts` — contract wrappers.
7. `htlc-ui/src/config/theme.ts` + `limits.ts` — design system + runtime safety windows.
8. `htlc-ui/src/components/{Layout/Header,MainLayout,Landing,WalletConnect,WalletGate,AsyncButton,SwapStatusChip,RecoveryBanner,ShareUrlCard}.tsx` — shared UI vocabulary.
9. `htlc-orchestrator/src/routes/swaps.ts` — REST surface the UI depends on.
10. `htlc-ft-cli/src/{alice-swap,bob-swap}.ts` — behavioral spec (CLI) if any state-machine question is ambiguous.

---

## Appendix: environment variables

### `htlc-ui/.env.preprod`

```bash
VITE_NETWORK_ID=preprod
VITE_LOGGING_LEVEL=trace
VITE_PROOF_SERVER_URI=http://127.0.0.1:6300
VITE_BLOCKFROST_API_KEY=preprod…                # in-bundle — demo only
VITE_ORCHESTRATOR_URL=http://localhost:4000     # advisory; UI works without it

# Optional safety window overrides (defaults in src/config/limits.ts)
# VITE_ALICE_MIN_DEADLINE_MIN=3
# VITE_ALICE_DEFAULT_DEADLINE_MIN=120
# VITE_BOB_MIN_CARDANO_WINDOW_SECS=180
# VITE_BOB_SAFETY_BUFFER_SECS=60
# VITE_BOB_DEADLINE_MIN=2
# VITE_BOB_MIN_DEPOSIT_TTL_SECS=60
# VITE_BROWSE_MIN_REMAINING_SECS=180
# VITE_WALLET_POPUP_HINT_MS=3000
```

### `htlc-orchestrator` env

```bash
PORT=4000
DATABASE_PATH=./data/swaps.db                   # better-sqlite3 file (WAL)
SWAP_STATE_PATH=../htlc-ft-cli/swap-state.json  # how the watcher finds contract addresses
BLOCKFROST_API_KEY=…                            # server-side; NOT shipped to clients
MIDNIGHT_NETWORK=preprod

# Optional stuck-swap alerter
STUCK_SWAP_WEBHOOK_URL=…                        # Slack / Discord / raw JSON (auto-detected)
STUCK_SWAP_SCAN_INTERVAL_MS=60000
STUCK_SWAP_ALICE_CLAIMED_STALE_MS=900000        # 15 min
STUCK_SWAP_REALERT_MS=21600000                  # 6 h
STUCK_SWAP_PUBLIC_UI_URL=https://…              # deep-link into /reclaim in alerts
```

### `htlc-ft-cli/.env`

```bash
BLOCKFROST_API_KEY=…                            # CLI uses this for Lucid Blockfrost provider
```

### Network switch (CLI only)

```bash
MIDNIGHT_NETWORK=preprod      # or: undeployed (local dev)
```
