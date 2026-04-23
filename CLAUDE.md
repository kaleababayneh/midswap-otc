# Midswap — Cross-Chain Atomic Swap (Midnight ⇄ Cardano)

> **Who this document is for.** A frontend-designer Claude session inheriting a
> working dApp called **Midswap**. The protocol, contracts, wallet bootstrap,
> state machines, reducers, observables, orchestrator, bidirectional flows,
> and preimage-relay paths are DONE and VERIFIED. Don't rewrite them. Read
> §8 "Browser architecture" and §14 "What's left for you", then polish.
>
> The app previously used Alice/Bob naming throughout and was forward-only
> (ADA → USDC). That's been replaced. Today: **Midswap** is a Uniswap-inspired
> app that supports bidirectional atomic swaps between Cardano ADA and Midnight
> native USDC, with a unified maker/taker model (no Alice/Bob language) and a
> Cardano-blue-on-Midnight-dark theme.

---

## 1. What this project is

A trustless atomic swap dApp between **Midnight** (privacy-focused L1) and
**Cardano Preprod**. Either party can initiate: someone offering ADA for USDC,
or someone offering USDC for ADA. Neither party can cheat — escrow is hash-
time-locked on both chains, and if either side times out the funds reclaim to
the original sender.

**Two flow directions**, both end-to-end verified on preprod:

- **`ada-usdc` (forward)** — maker locks ADA on Cardano first; taker deposits
  USDC on Midnight; maker claims USDC on Midnight (reveals preimage on
  Midnight); taker claims ADA on Cardano using the revealed preimage.
- **`usdc-ada` (reverse)** — maker deposits USDC on Midnight first; taker
  locks ADA on Cardano; maker claims ADA on Cardano (reveals preimage via
  the Cardano tx redeemer); taker reads the preimage back via Blockfrost
  and claims USDC on Midnight.

Both flows are mirror images. The same contract code serves both — the
`htlc.compact` circuit is color-parametric, and the Cardano validator is HTLC-
generic. Only the client-side orchestration and the preimage-relay path
differ.

**Two Midnight contracts** (deliberate split, unchanged from the original
design):

- `usdc.compact` — pure USD Coin minter over Midnight's native unshielded-token
  primitives (`mintUnshieldedToken` / `receiveUnshielded` / `sendUnshielded`).
  No internal ledger — coins live in user wallets as Zswap UTXOs.
- `htlc.compact` — generic, color-parametric hash-time-locked escrow. Pulls
  coins in on deposit, releases to receiver on `withdrawWithPreimage`, refunds
  to sender on `reclaimAfterExpiry`. Works with any color, not just USDC.

**One Cardano validator**: `cardano/validators/htlc.ak` (Aiken → Plutus V3).
Standard hash-time-lock, off-chain driver via Lucid Evolution.

## 2. Current status

### Verified end-to-end on preprod

- **Forward (ADA→USDC) two-browser swap:** Alice locks ADA in Eternl → Bob
  opens URL in second browser → Bob deposits USDC via Lace → Alice claims USDC
  (reveals preimage on Midnight) → Bob claims ADA. Swap completes, funds move.
- **Reverse (USDC→ADA) two-browser swap:** Maker deposits USDC on Midnight
  first with counterparty's Midnight keys bundled via a paste string → Maker
  shares URL → Taker verifies the Midnight deposit is bound to their wallet →
  Taker locks ADA on Cardano bound to the maker's PKH → Maker claims ADA on
  Cardano (preimage reveals via tx redeemer) → Taker reads the preimage back
  via Blockfrost redeemer endpoints + orchestrator fast-path → Taker claims
  USDC on Midnight.
- **CLI regression:** `npx tsx htlc-ft-cli/src/execute-swap.ts` — passes (still
  forward-only; CLI hasn't been extended to reverse).

### What the verification proves

- Contract split (htlc + usdc) is load-bearing-correct for both directions.
- Bidirectional state machines are sound. The same contracts, circuits, and
  deadlines support both directions; only the ordering and the preimage-relay
  path differ.
- Orchestrator-relay plus Blockfrost redeemer fallback delivers the preimage
  to the reverse taker quickly and reliably.
- Native unshielded coin I/O (`receiveUnshielded` / `sendUnshielded`) works in
  both the maker-first and taker-first ordering.
- bech32m ↔ Bytes<32> decoding via `@midnight-ntwrk/wallet-sdk-address-format`
  fixes the "Only designated receiver" bug in both directions.

### The "what's next" for you (frontend-designer session)

Behaviour is complete in both directions. Visual polish, copy, empty states,
responsive behaviour, onboarding clarity, and error-recovery affordances are
the next frontier. See §14.

## 3. Repo layout

```
example-bboard/
├── CLAUDE.md                                   ← you are here
├── contract.md                                 ← proposed HTLC simplification (drop-auth design)
├── credit.md                                   ← Uniswap-interface design credit
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
├── htlc-ft-cli/                                ← reference CLI implementation (behavioural spec)
│   └── src/
│       ├── execute-swap.ts                     ← single-process regression (forward only)
│       ├── alice-swap.ts / bob-swap.ts         ← two-terminal forward flow
│       ├── reclaim-ada.ts / reclaim-usdc.ts    ← refund paths
│       ├── setup-contract.ts                   ← deploys both contracts, mints seed USDC
│       ├── mint-usdc.ts                        ← mint more USDC after setup
│       ├── midnight-watcher.ts                 ← polls indexer (deposits + revealedPreimages)
│       ├── cardano-watcher.ts                  ← polls Blockfrost (HTLC UTxOs)
│       ├── cardano-htlc.ts                     ← Lucid Evolution driver (CLI-only; not reverse-aware)
│       ├── midnight-wallet-provider.ts         ← CLI-only seed wallet
│       └── config.ts                           ← MIDNIGHT_NETWORK switch
│
├── htlc-ui/                                    ← THE frontend = Midswap
│   ├── public/
│   │   ├── keys/                               ← populated by predev (htlc + usdc prover/verifier)
│   │   ├── zkir/                               ← populated by predev
│   │   └── plutus.json                         ← populated by predev (Cardano blueprint)
│   ├── src/
│   │   ├── main.tsx                            ← CssBaseline + Theme + Toast + Swap providers
│   │   ├── App.tsx                             ← BrowserRouter + routes + legacy redirects
│   │   ├── globals.ts                          ← Buffer / process polyfills (keep as-is)
│   │   ├── vite-env.d.ts
│   │   ├── swap-state.json                     ← contract addresses + usdcColor
│   │   ├── in-memory-private-state-provider.ts ← per-contract private-state cache
│   │   ├── config/
│   │   │   ├── theme.ts                        ← MUI theme: Cardano-blue on Midnight-dark
│   │   │   └── limits.ts                       ← runtime-configurable safety windows
│   │   ├── api/
│   │   │   ├── common-types.ts                 ← HTLCProviders, USDCProviders, HTLCEntry
│   │   │   ├── key-encoding.ts                 ← bech32m ↔ Bytes<32>, userEither() helper
│   │   │   ├── htlc-api.ts                     ← HtlcAPI (state$ + deposit/withdraw/reclaim, returns tx hashes)
│   │   │   ├── usdc-api.ts                     ← UsdcAPI (state$ + mint)
│   │   │   ├── cardano-htlc-browser.ts         ← CardanoHTLCBrowser (CIP-30) + findClaimPreimage
│   │   │   ├── midnight-watcher.ts             ← watchForHTLCDeposit / watchForPreimageReveal
│   │   │   ├── cardano-watcher.ts              ← watchForCardanoLock / waitForCardanoHTLCConsumed
│   │   │   └── orchestrator-client.ts          ← typed REST client, direction-aware
│   │   ├── contexts/
│   │   │   ├── BrowserHtlcManager.ts           ← wallet bootstrap + decoded keys
│   │   │   ├── SwapContext.tsx                 ← Midnight + Cardano session state
│   │   │   ├── ToastContext.tsx                ← app-wide Snackbar queue
│   │   │   └── index.ts
│   │   ├── hooks/
│   │   │   ├── useSwapContext.ts
│   │   │   ├── useToast.ts
│   │   │   └── index.ts
│   │   └── components/
│   │       ├── Layout/{MainLayout,Header,Logo,index}.tsx
│   │       ├── swap/                           ← the unified bidirectional swap UI
│   │       │   ├── SwapCard.tsx                ← dual-input Uniswap-style card, flip + CTA + settings
│   │       │   ├── SwapProgressModal.tsx       ← modal stepper, direction-aware phase list
│   │       │   ├── SettingsDialog.tsx          ← deadline slider + safety-window summary
│   │       │   ├── TokenRow.tsx                ← "You pay" / "You receive" row
│   │       │   ├── TokenBadge.tsx              ← gradient disc monogram
│   │       │   ├── tokens.ts                   ← ADA / USDC / FlowDirection / Role / FLOW_PAIR
│   │       │   ├── keyBundle.ts                ← `cpk:unshielded` paste format
│   │       │   ├── useMakerFlow.ts             ← forward maker reducer (extracted from old AliceSwap)
│   │       │   ├── useTakerFlow.ts             ← forward taker reducer (extracted from old BobSwap)
│   │       │   ├── useReverseMakerFlow.ts      ← reverse maker reducer (new)
│   │       │   └── useReverseTakerFlow.ts     ← reverse taker reducer (new)
│   │       ├── Home.tsx                        ← landing: hero + SwapCard + feature tiles
│   │       ├── Browse.tsx                      ← open offers (both directions)
│   │       ├── Activity.tsx                    ← all swaps, direction column (renamed from Dashboard)
│   │       ├── Reclaim.tsx                     ← list-driven + manual-by-hash refund
│   │       ├── MintUsdc.tsx                    ← self-serve mint
│   │       ├── HowTo.tsx                       ← plain-prose protocol explainer
│   │       ├── WalletGate.tsx                  ← "install extension" gate for pages that need wallets
│   │       ├── WalletMenu.tsx                  ← header wallet pill with copy/paste bundle
│   │       ├── ShareUrlCard.tsx                ← QR + copy + native share
│   │       ├── SwapStatusChip.tsx              ← direction-neutral status labels
│   │       ├── AsyncButton.tsx                 ← spinner + "check your wallet" hint
│   │       ├── RecoveryBanner.tsx              ← banner if user has reclaimable swaps
│   │       └── index.ts
│   ├── .env.preprod                            ← VITE_NETWORK_ID + proof server + Blockfrost key
│   ├── index.html                              ← Inter + JetBrains Mono Google Fonts
│   ├── package.json                            ← predev copies keys/zkir/plutus.json
│   └── vite.config.ts
│
└── htlc-orchestrator/                          ← advisory backend, bidirectional
    └── src/
        ├── server.ts                           ← Fastify + CORS + routes + watchers
        ├── db.ts                               ← better-sqlite3, additive migrations, direction column
        ├── schema.sql                          ← target schema; migrations run separately in db.ts
        ├── types.ts                            ← Swap/CreateSwapBody/PatchSwapBody, FlowDirection
        ├── routes/swaps.ts                     ← direction-branched POST validation
        ├── midnight-watcher.ts                 ← direction-aware state transitions
        ├── cardano-watcher.ts                  ← direction-aware + preimage redeemer extraction
        └── stuck-alerter.ts                    ← direction-aware stuck classification
```

Legacy scaffolding still present (DO NOT delete — reference material only):
- `api/` — old BBoard API layer (template that `HtlcAPI` / `UsdcAPI` copy from).

**Deleted in this session** (don't try to restore — their logic lives elsewhere):
`AliceSwap.tsx`, `BobSwap.tsx`, `Landing.tsx`, `Dashboard.tsx`, `WalletConnect.tsx`.
The reducers migrated into `useMakerFlow.ts` / `useTakerFlow.ts` / the two reverse
hooks; Landing/Dashboard got replaced by Home/Activity; WalletConnect folded
into WalletMenu + WalletGate.

## 4. The HTLC contract (generic escrow, unchanged)

File: `contract/src/htlc.compact` · Compiled TS: `contract/src/managed/htlc/contract/index.d.ts`

Circuits:

```typescript
// Lock: pulls `amount` coins of `color` from caller (receiveUnshielded),
//       records the record keyed by `hash`.
deposit(args): []

// Claim: ownPublicKey().bytes must match receiverAuth; preimage persisted
//        in revealedPreimages[hash]; coins → receiverPayout; amount → 0.
withdrawWithPreimage(arg): []

// Refund after deadline: ownPublicKey().bytes must match senderAuth;
//                        coins → senderPayout.
reclaimAfterExpiry(arg): []
```

Ledger (all `export ledger`, indexer-queryable):

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

Completion is marked by `htlcAmounts[hash] = 0` (Compact maps have no delete).
Auth (who can call) and payout (where coins go) are stored separately because
Compact can't derive one from the other inside a circuit.

**Proposed simplification documented in `contract.md`** — drop `htlcSenderAuth`
/ `htlcReceiverAuth`, keep only the payouts. Reduces the reverse-maker's
counterparty input from two keys to one (unshielded only). Trade-off is a
mempool-front-run griefing attack that burns gas but can't steal funds. Not
implemented; flagged for a future contract revision.

## 5. The USDC contract (native-token minter, unchanged)

File: `contract/src/usdc.compact`. Circuits: `mint`, `name`, `symbol`,
`decimals`, `color`. First `mint()` captures `_color`; subsequent mints produce
coins of that same color. **No access control on `mint()`** — fine for preprod
demos; production would need gating.

## 6. The Cardano HTLC (Aiken, unchanged)

File: `cardano/validators/htlc.ak` · Compiled: `cardano/plutus.json`.
PlutusV3 spending validator:

- **Datum:** `{ preimageHash, sender (PKH), receiver (PKH), deadline (POSIX ms) }`
- **Redeemer:** `Withdraw { preimage }` | `Reclaim`
- **Withdraw:** `sha256(preimage) == datum.preimageHash` AND `upper_bound < deadline` AND signer = receiver
- **Reclaim:** `lower_bound > deadline` AND signer = sender

Slot-alignment fix for reclaim: `+1000ms` offset on `validFrom` — preserved in
both CLI and browser drivers.

Claim validity bounds — updated this session (see §12):
- `validTo = deadline - 30_000ms` (was 60s — too eager for reverse flow's 2h deadline)
- Pre-flight throws with a clear message if the window has collapsed.
- Retries `findHTLCUtxo` up to 40 s to tolerate Blockfrost's 20-30s UTxO-index lag after the taker's lock.

## 7. The protocol, bidirectional

### Forward flow (`ada-usdc`)

```
Maker has ADA on Cardano, wants USDC on Midnight.
Taker has USDC on Midnight, wants ADA on Cardano.

STEP 1. Maker generates a random 32-byte PREIMAGE → HASH = SHA256(PREIMAGE).
STEP 2. Maker locks ADA on Cardano HTLC:
           datum = { hash, sender=maker_pkh, receiver=taker_pkh, deadline=now+~4h }
STEP 3. Maker shares the offer URL / posts to orchestrator.
STEP 4. Taker watches Cardano, finds maker's lock by hash+own PKH, validates
        deadline safety, then deposits native USDC on Midnight HTLC:
           deposit(color=usdc, amount, hash, expirySecs=now+~2h,
                   receiverAuth=maker_cpk, receiverPayout=maker_unshielded,
                   senderPayout=taker_unshielded)
STEP 5. Maker claims USDC on Midnight:  withdrawWithPreimage(PREIMAGE).
        Preimage → revealedPreimages[hash]; coins → maker_unshielded.
STEP 6. Taker reads PREIMAGE from Midnight's revealedPreimages[hash].
STEP 7. Taker claims ADA on Cardano using PREIMAGE as the redeemer.
```

### Reverse flow (`usdc-ada`)

```
Maker has USDC on Midnight, wants ADA on Cardano.
Taker has ADA on Cardano, wants USDC on Midnight.

STEP 1. Maker generates a random 32-byte PREIMAGE → HASH = SHA256(PREIMAGE).
STEP 2. Maker obtains the TAKER's Midnight keys via a paste-bundle
        (`cpk:unshielded`) the taker copied from their Midswap wallet menu.
STEP 3. Maker deposits USDC on Midnight HTLC:
           deposit(color=usdc, amount, hash, expirySecs=now+~4h,
                   receiverAuth=taker_cpk, receiverPayout=taker_unshielded,
                   senderPayout=maker_unshielded)
STEP 4. Maker shares the offer URL (direction=usdc-ada, includes their own PKH).
STEP 5. Taker watches Midnight for the deposit bound to their own cpk,
        validates deadlines, then locks ADA on Cardano HTLC:
           datum = { hash, sender=taker_pkh, receiver=maker_pkh, deadline=now+~2h }
STEP 6. Maker claims ADA on Cardano:  Withdraw { preimage }.
        Preimage is committed to the Cardano tx's spend redeemer. No
        Midnight side-effect — just the Cardano claim + tx landing.
STEP 7. Taker reads the preimage from the Cardano spend tx's redeemer
        (via Blockfrost `/txs/{hash}/redeemers` + `/scripts/datum/{hash}/cbor`)
        OR from the orchestrator's `midnightPreimage` (fast-path, patched by
        the maker at claim time).
STEP 8. Taker claims USDC on Midnight:  withdrawWithPreimage(PREIMAGE).
```

In both flows, the second party locks with a tighter deadline nested inside
the first party's deadline (safety buffer default 5 min). The preimage always
becomes public on whichever chain the maker claims on; the taker reads it back
from there.

Chain state remains authoritative in both directions. The orchestrator is a
fast-path view + preimage relay, not a source of truth.

## 8. Browser architecture (`htlc-ui/`)

### Bootstrap order (`main.tsx`)

```
<CssBaseline />
<ThemeProvider theme={theme}>             ← src/config/theme.ts (Cardano-blue on Midnight-dark)
  <ToastProvider>                         ← src/contexts/ToastContext.tsx
    <SwapProvider logger={logger}>        ← src/contexts/SwapContext.tsx
      <App />
    </SwapProvider>
  </ToastProvider>
</ThemeProvider>
```

### Routes (`App.tsx`)

| Path         | Component   | Purpose                                                     |
|--------------|-------------|-------------------------------------------------------------|
| `/`          | `Home`      | Hero + SwapCard + feature tiles. URL params drive taker mode. |
| `/swap`      | `Home`      | Same as `/` — alias used in share URLs.                      |
| `/browse`    | `Browse`    | Open offers from orchestrator, both directions.              |
| `/activity`  | `Activity`  | All swaps, direction column, tx deep-links.                  |
| `/reclaim`   | `Reclaim`   | List-driven refund, direction-aware.                         |
| `/mint`      | `MintUsdc`  | Self-serve USDC mint (demo affordance).                      |
| `/how`       | `HowTo`     | Onboarding walkthrough.                                      |
| Legacy       | redirect    | `/alice`, `/bob`, `/dashboard`, `/mint-usdc`, `/how-to` → current. |

### SwapCard is the heart of the UI (`src/components/swap/SwapCard.tsx`)

One 480-px rounded card, Uniswap-style. Holds:
- Header: title ("Swap") + direction subtitle ("ADA→USDC offer" / "USDC→ADA
  offer" / "Take ADA→USDC offer" / etc.) + settings gear.
- Pay row (TokenRow).
- Flip button (absolutely positioned, `translate(-50%, -50%)` — stays clean
  visually between the rows).
- Receive row (TokenRow).
- Direction-aware counterparty input(s):
  - `maker, ada-usdc`: one field — "Counterparty Cardano address or PKH".
  - `maker, usdc-ada`: two fields — "Midnight shielded coin key" + "Midnight
    unshielded address". Plus a "Paste bundle" button above them that pastes
    a `cpk:unshielded` single-string bundle into both fields at once.
  - `taker, *`: offer-summary card (hash + deadline), no input.
- Primary CTA (bottom, full-width pill) — label adapts to state:
  - Missing wallets → "Connect Midnight + Cardano" / "Connect Midnight wallet" / "Connect Cardano wallet"
  - Maker amounts missing → "Enter amount"
  - Maker counterparty missing → "Enter counterparty Cardano address" / "Enter counterparty Midnight keys"
  - Maker ready → "Review & lock N ADA" or "Review & deposit N USDC"
  - Taker waiting → "View progress"
- Footer: "Need USDC? Mint on Midnight · How it works".

Flip button behaviour:
- In maker mode, toggles `flowDirection` between `ada-usdc` and `usdc-ada`.
  Blocks if a flow is in flight (toast warning).
- In taker mode, clears the URL and returns to maker mode (ada-usdc default).

### The progress modal (`SwapProgressModal.tsx`)

Opens when the active flow transitions out of `idle`. Shows a vertical
stepper with four phases per flow. The phase descriptions adapt per `role ×
flowDirection`; the builder functions are `buildForwardMakerPhases`,
`buildForwardTakerPhases`, `buildReverseMakerPhases`, `buildReverseTakerPhases`.

Each phase has a status (pending / active / done / error), a subtitle, and an
optional action (the ShareUrlCard at the share step; AsyncButton for claims).

Key UX behaviour: clicking "Hide" on the modal does NOT re-open on every
render — only on a state transition out of idle. The `modalOpen` state is
keyed off `activeState.kind` so users can dismiss and inspect the card
underneath until the next meaningful state change.

### Provider chain (unchanged from pre-Midswap)

`BrowserHtlcManager.ts` — the hardest-to-rederive code:
1. Polls `window.midnight?.[key]` every 100 ms until a Lace-compatible API
   appears. Filters by semver (`COMPATIBLE_CONNECTOR_API_VERSION = '4.x'`).
2. Calls `initialAPI.enable()` → `connectedAPI`.
3. Fetches `getConfiguration()`, `getShieldedAddresses()`, `getUnshieldedAddress()`.
4. **Decodes bech32m → Bytes<32>** via `src/api/key-encoding.ts` (Landmine #1).
5. Builds two provider bundles: `HTLCProviders` + `USDCProviders`, sharing
   `publicDataProvider`/`walletProvider`/`midnightProvider`/`proofProvider` and
   each holding its own `inMemoryPrivateStateProvider`.
6. Returns `SwapBootstrap` — raw bytes + hex + bech32m for both keys.

`SwapContext.tsx` — React context around the bootstrap, idempotent connect
calls for Midnight (Lace) and Cardano (any CIP-30, prefers Eternl).

### Direction-aware hooks

- `useMakerFlow` — forward maker; extracted 1:1 from the old AliceSwap
  reducer. Auto-transitions `locked → waiting-deposit` (removed the old manual
  "Watch Midnight" click gate — the progress modal makes the share URL
  prominent anyway, so the click added no safety). Preserves the
  `localStorage` preimage-persistence path verbatim.
- `useTakerFlow` — forward taker; 1:1 from old BobSwap. Safety windows
  (`bobMinCardanoWindowSecs`, `bobSafetyBufferSecs`, `bobMinDepositTtlSecs`)
  preserved verbatim.
- `useReverseMakerFlow` — reverse maker; mirror of useMakerFlow for
  USDC-first. Its own `localStorage` key (`htlc-ui:reverse-maker-pending-swap:`).
- `useReverseTakerFlow` — reverse taker; mirror of useTakerFlow.

All four hooks write to the orchestrator (`createSwap` at initial lock,
`patchSwap` at every transition) and poll it for fast-path signals (preimage,
counterparty lock). Each also falls back to chain-authoritative indexers
(Midnight indexer, Blockfrost) when the orchestrator is unreachable.

## 9. Design system (`src/config/theme.ts`)

- **Dark mode, Cardano-blue primary on Midnight-dark background.**
- Primary gradient:
  `linear-gradient(135deg, #4B8CFF 0%, #2E7BFF 45%, #1A4FD1 100%)`.
- Surface scale: `#0A0B13` (page) → `#12131E` (card) → `#1A1C2B` (inset) →
  `#242738` (hover).
- Subtle radial-gradient "midnight glow" in the backdrop of MainLayout.
- Typography: **Inter** 400/500/600/700/800, with JetBrains Mono for hashes/
  addresses. Loaded via Google Fonts in `index.html`.
- Radii: 999 (pill buttons), 20-24 (cards), 14-16 (inputs, chips, alerts).
- Custom palette tokens on `theme.custom` — every page reads from there
  rather than re-deriving, so a palette bump propagates cleanly.

Shared components:
- `<AsyncButton>` — spinner + disable + "Check your wallet" hint after
  `limits.walletPopupHintMs` (default 3s).
- `<WalletGate>` — detects missing Lace / Eternl, surfaces install links,
  blocks children until wallets are connected.
- `<WalletMenu>` — header pill that opens a popover with per-chain connect
  buttons, copy-address icons, balance display, and a **"Copy both (bundle)"**
  button that packages the Midnight keys as `cpk:unshielded` for the
  counterparty to paste in reverse mode.
- `<SwapStatusChip>` — direction-neutral status vocabulary (`Open`,
  `Counterparty locked`, `Preimage revealed`, `Completed`, `Maker reclaimed`,
  `Taker reclaimed`, `Expired`).
- `<TokenBadge>` — gradient disc with a single letter (A, U). Used in
  SwapCard, OfferCard, SwapProgressModal headers.
- `<ShareUrlCard>` — QR + copy + native share.
- `<RecoveryBanner>` (in `MainLayout`) — polls orchestrator; banner if user
  has reclaimable stuck swaps; direction-aware.
- `<Toast>` via `useToast()` — success/info/warning/error, single snackbar + queue.

## 10. Runtime config (`src/config/limits.ts`)

Every time-window is overridable via `VITE_*` env vars. Defaults target
**realistic "wander off and come back" user behaviour**, not tight demos —
bump-downs for quick iteration are in `.env.preprod`.

```typescript
aliceMinDeadlineMin:       VITE_ALICE_MIN_DEADLINE_MIN       ?? 10      // min maker-set deadline
aliceDefaultDeadlineMin:   VITE_ALICE_DEFAULT_DEADLINE_MIN   ?? 240     // 4h outer wrapper
bobMinCardanoWindowSecs:   VITE_BOB_MIN_CARDANO_WINDOW_SECS  ?? 600     // taker pre-check
bobSafetyBufferSecs:       VITE_BOB_SAFETY_BUFFER_SECS       ?? 300     // gap between inner/outer deadlines
bobDeadlineMin:            VITE_BOB_DEADLINE_MIN             ?? 120     // 2h forward taker (Midnight)
reverseTakerDeadlineMin:   VITE_REVERSE_TAKER_DEADLINE_MIN   ?? 120     // 2h reverse taker (Cardano)
bobMinDepositTtlSecs:      VITE_BOB_MIN_DEPOSIT_TTL_SECS     ?? 600     // floor for truncated TTL
browseMinRemainingSecs:    VITE_BROWSE_MIN_REMAINING_SECS    ?? 300     // Browse hides offers expiring within this
walletPopupHintMs:         VITE_WALLET_POPUP_HINT_MS         ?? 3000
```

**Pre-flight deadline check** inside `useMakerFlow.claim()` surfaces a user-
actionable error if the entry is already expired or within 60s of expiry —
avoids burning ~18 DUST on a tx that will `SegmentFail`.

## 11. The orchestrator (`htlc-orchestrator/`, bidirectional)

Fastify + SQLite (`better-sqlite3`) + two watchers.

### Schema changes made this session

New column `direction` (`'ada-usdc' | 'usdc-ada'`, default `'ada-usdc'`,
CHECK-constrained). Made `cardano_deadline_ms` / `cardano_lock_tx` nullable
(they're filled later for reverse swaps). Migration inside `db.ts` is
additive and rebuild-based — it preserves every existing row and backfills
`direction='ada-usdc'` for them.

Field semantics are direction-aware:

| field              | `ada-usdc` (forward)            | `usdc-ada` (reverse)              |
|--------------------|---------------------------------|-----------------------------------|
| `aliceCpk / Unshielded` | maker's Midnight keys       | maker's Midnight keys             |
| `cardanoLockTx`    | maker lock (at create)          | taker lock (PATCHed)              |
| `cardanoDeadlineMs`| maker deadline                  | taker deadline                    |
| `bobPkh`           | taker's Cardano PKH             | maker's own Cardano PKH           |
| `midnightDepositTx`| taker deposit (PATCHed)         | maker deposit (at create)         |
| `midnightDeadlineMs`| taker deadline                 | maker deadline                    |
| `bobCpk / bobUnshielded` | taker Midnight keys (PATCHed) | taker Midnight keys (at create) |
| `midnightPreimage` | revealed on Midnight (by maker's claim) | revealed via Cardano tx redeemer (by maker's claim) |

### Watchers

**`midnight-watcher.ts`** — direction-aware:
- `ada-usdc`: `open→bob_deposited` on first deposit; `bob_deposited→alice_claimed`
  on preimage reveal; `bob_deposited→bob_reclaimed` on `amount=0 && no preimage`.
- `usdc-ada`: `→completed` when `amount=0 && preimage revealed`; `→alice_reclaimed`
  when `amount=0 && no preimage && past deadline`. Midnight doesn't
  observe the preimage-reveal event in this direction — that's on Cardano.

**`cardano-watcher.ts`** — direction-aware, with preimage relay:
- `ada-usdc`: `alice_claimed→completed` on UTxO spent; `open|bob_deposited→alice_reclaimed`
  on post-deadline spend.
- `usdc-ada`: `open→bob_deposited` when a new HTLC UTxO appears bound to the
  maker's PKH (verified against our `bob_pkh` field); `bob_deposited→alice_claimed`
  on UTxO spent — **extracts the preimage from the spend tx's redeemer
  via Blockfrost `/txs/{hash}/redeemers` + `/scripts/datum/{hash}/cbor`
  endpoints** and PATCHes `midnight_preimage` so the reverse taker's
  fast-path lights up before their Blockfrost polling loop catches up;
  `bob_deposited→bob_reclaimed` on post-deadline spend with no Withdraw
  redeemer.

### REST API

```
POST   /api/swaps                 CreateSwapBody → Swap (409 if hash exists)
                                  Direction-branched validation.
GET    /api/swaps?status=X&direction=Y → { swaps: Swap[] }
GET    /api/swaps/:hash           → Swap
PATCH  /api/swaps/:hash           PatchSwapBody → Swap
                                  Now accepts `cardanoLockTx` + `cardanoDeadlineMs`
                                  as patchable fields (for reverse taker's PATCH
                                  on their Cardano lock).
GET    /health                    → { ok, db }
```

### Authority model

Unchanged: orchestrator is a view and a fast-path relay; never authoritative.
If the orchestrator is down, every flow still works — the hooks fall back to
the Midnight indexer / Blockfrost directly. The orchestrator just shaves
5-10s off each cross-chain notification.

## 12. Known incidents and gotchas

### Landmine #1: bech32m ↔ Bytes<32> — RESOLVED (still active)

Same as before. `BrowserHtlcManager` decodes both keys via `decodeShieldedCoinPublicKey`
/ `decodeUnshieldedAddress` at bootstrap. All `receiverAuth` / `receiverPayout`
/ `senderPayout` fields flow through `src/api/key-encoding.ts`. Do not pass
bech32m strings into the contract. The reverse-maker flow accepts either
bech32m or 64-hex in its counterparty-key inputs — both paths go through the
same decoders.

### Landmine #2: stale Cardano UTxOs at the shared script address — RESOLVED

`watchForCardanoLock` MUST filter by `(receiverPkh, hashHex, deadline > now)`.
Both forward and reverse flows pass all three. Do not "simplify" the watcher
signature.

### Landmine #3: ZK asset hosting — unchanged

`FetchZkConfigProvider` fetches `${origin}/keys/<circuit>.{prover,verifier}`
and `${origin}/zkir/<circuit>.bzkir`. `predev` hook populates `public/keys/`
+ `public/zkir/` from `contract/src/managed/{htlc,usdc}/`. Circuit names
don't collide so a flat merge works.

### Landmine #4: deadline-floor bug — RESOLVED (safety checks still in place)

The original 2-minute `bobDeadlineMin` was too tight even for forward flow;
bumped to 120. Reverse flow got its own `reverseTakerDeadlineMin` (also 120
min). Safety floors (`bobMinCardanoWindowSecs`, `bobMinDepositTtlSecs`,
`bobSafetyBufferSecs`) bumped from seconds-scale to minutes-scale.

### Landmine #5: Lace dApp-connector quirk (NEW this session) — RESOLVED

Lace's `submitTransaction` sometimes rejects with `DAppConnectorAPIError /
Transaction submission error` **even though the tx actually landed on-chain**.
This manifested as:
- Reverse-maker deposit "failing" but the USDC being visibly escrowed.
- Forward-taker deposit "failing" then the retry failing with `HTLC already
  active for this hash` (the first submit had succeeded).

**Pattern fix, applied in `useReverseMakerFlow.deposit` and `useTakerFlow.deposit`:**
when the submit throws, don't error out. Poll the Midnight indexer for up
to 45-60s to see if the entry appeared. For the taker flow, also verify
`receiverAuth` matches the expected maker cpk (so a stranger's deposit
with the same hash doesn't accidentally count). If verified, continue
as if the submit succeeded — toast info: "Wallet returned an error but the
deposit landed on-chain — continuing."

This pattern could reasonably be applied to `withdrawWithPreimage` and
`reclaimAfterExpiry` too. It hasn't been yet — tell your frontend designer
if you want coverage.

### Landmine #6: Blockfrost UTxO-index lag (NEW this session) — RESOLVED

After the reverse taker submits their Cardano lock, their client PATCHes the
orchestrator **immediately**. The reverse maker's UI picks this up (via
orchestrator fast-path poll) and transitions to `claim-ready`. But Blockfrost's
UTxO-at-address index typically lags tx submit by 20-30s. If the maker clicks
Claim during that window, `findHTLCUtxo` returns nothing → "No HTLC UTxO
found for hash …" error.

**Two-layer fix:**
1. The orchestrator-fast-path poll inside `useReverseMakerFlow`'s `waiting-cardano`
   effect now VERIFIES that Blockfrost can see the UTxO before dispatching
   `cardano-seen`. Until it can, the Claim button stays grayed out / absent.
2. `cardanoHtlc.claim()` itself retries `findHTLCUtxo` with 5s backoff up to
   8 attempts (40s total) as a safety net, plus `cardanoHtlc.reclaim()` gets
   the same with a 4-attempt budget.

### Landmine #7: Reverse-flow's two-key counterparty input (NEW this session) — MITIGATED

In reverse mode, the maker needs BOTH the taker's Midnight shielded coin key
(for `receiverAuth`) AND the taker's Midnight unshielded address (for
`receiverPayout`). These are distinct HD-role keys that cannot be derived
from each other — the Midnight wallet architecture has separate shielded
(Zswap) and unshielded (Night) layers.

UX mitigation: the WalletMenu exposes a **"Copy both (bundle)"** action that
packages both keys as `cpk:unshielded`. The SwapCard's reverse-maker section
has a **"Paste bundle"** button and smart-paste handling in both text fields
(pasting a bundle into either one auto-splits).

Protocol-level simplification (drop `receiverAuth` entirely, accept a gas-
griefing risk) is proposed in `contract.md` but not implemented.

### Gotcha: Compact map semantics — unchanged

No delete. `amount = 0` = completed. The derived-state pipelines treat `0n`
as "done, don't surface to user".

### Gotcha: Blockfrost key in client bundle — unchanged

`VITE_BLOCKFROST_API_KEY` ships to every user. Fine for preprod; production
needs a backend proxy. Flagged in §14.

### Gotcha: multiple Lace / Eternl APIs — unchanged

`window.cardano` can have several entries. `SwapContext.connectCardano(name?)`
defaults to Eternl, falls back to Lace-Cardano, Nami, Flint, Typhon. If
users switch Cardano wallets after connecting, they need to disconnect+reconnect.

## 13. Running it

### Prereqs

- Cardano Preprod Blockfrost key in `htlc-ui/.env.preprod`.
- Midnight local proof server at `127.0.0.1:6300`.
- Midnight preprod endpoints reachable.
- Lace (for Midnight AND Cardano — both extensions are under the same
  Lace umbrella in the current setup) OR Lace (Midnight) + Eternl (Cardano).
- Both wallets funded: Midnight via https://faucet.preprod.midnight.network/
  (dust auto-generates, ~15 min sync first time); Cardano via preprod faucet.

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

# 4. Start the orchestrator (recommended — enables /browse + fast-path)
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

**Forward (ADA→USDC)**:
- Browser A: visit `http://localhost:5173/`, connect wallets, fill amounts,
  paste taker's Cardano address/PKH, click "Review & lock", sign in Eternl.
- Browser A: copy share URL from the progress modal's "Share the offer" step.
- Browser B: navigate to the share URL, connect wallets, accept, deposit.
- Browser A: "Claim USDC" button lights up; click, sign.
- Browser B: "Claim ADA" button lights up; click, sign.

**Reverse (USDC→ADA)**:
- Browser B (taker-to-be): open WalletMenu, click "Copy both (bundle)", send
  the string to Browser A's user.
- Browser A: visit `/`, connect wallets, click the flip arrow to switch to
  USDC→ADA, paste the bundle (either as bundle or into one of the two fields
  — auto-splits), fill amounts, click "Review & deposit", sign in Lace.
- Browser A: copy share URL.
- Browser B: navigate to share URL (URL carries `direction=usdc-ada&makerPkh=…`),
  verify, accept, sign the Cardano lock in Eternl.
- Browser A: "Claim ADA" button appears (only after Blockfrost indexes the
  lock, ~20-30s); click, sign in Eternl.
- Browser B: preimage arrives via orchestrator fast-path or Blockfrost
  redeemer read → "Claim USDC" button appears; click, sign in Lace.

### CLI regression (sanity check)

Forward only:
```bash
cd htlc-ft-cli
npx tsx src/execute-swap.ts          # single-process regression
npx tsx src/smoke-native.ts          # Midnight-only
npx tsx src/smoke-cardano-reclaim.ts # Cardano-only
```

Two-terminal: `MIDNIGHT_NETWORK=preprod npx tsx src/alice-swap.ts` and
`bob-swap.ts`.

## 14. What's left for you (frontend-designer session)

Behaviour is complete. These are the visual and UX gaps between "functional"
and "something a stranger would feel comfortable moving real money through."

### A. Onboarding + empty states

- First-time visit to `/` with no wallets connected should feel less like a
  blank card and more like an inviting "pick your direction" moment.
- `/browse` with zero offers shows a dashed-border empty state already; it
  works but could be warmer / more illustrative.
- `/activity` empty state exists; similar opportunity.
- `/reclaim` empty state ("Nothing to reclaim — you're good") could be a
  celebration rather than a neutral info panel.

### B. Progress modal polish

- The stepper is legible but dense. A designer could add more contrast
  between done/active/pending states, and the phase copy in the reverse
  direction is noticeably drier than forward — worth a prose pass.
- The "Hide" button is honest (the flow keeps running) but the affordance
  that the modal will re-open on state change isn't explained. A small
  "we'll notify you when the counterparty acts" sub-line would close the
  loop.

### C. Error copy

- Most catch blocks now have user-actionable messages (e.g. the new pre-flight
  deadline check, the Lace verify-on-error toast, Blockfrost-not-indexed
  retries) but the visual treatment is still generic MUI Alert. A tonal pass
  across the four error classes (user rejected, network/indexer, contract
  assertion, deadline-related) would help.
- Reverse-maker's two-key input has been mitigated via the bundle flow, but
  an unfamiliar user could still stare at it and not know where to get the
  bundle. A small "Where do I get this?" link under each input, pointing to
  a mini-explanation, would help.

### D. Share flow

- `ShareUrlCard` works. A "Copy as QR image" option would be nice alongside
  "Copy URL" and "Share…".
- After sharing, the maker's progress modal could show a more prominent
  counter ("Waiting for counterparty… 2m 14s elapsed") and maybe a "Remind
  me when they act" affordance (browser notification permission).

### E. Success confirmation

- `done` state in the modal shows "Funds received" and amounts. A designer
  could turn this into a small celebratory moment — a share-to-social card,
  explorer links, "Swap again" CTA.

### F. Things to explicitly NOT change

- **Hook reducers** (useMakerFlow, useTakerFlow, useReverseMakerFlow,
  useReverseTakerFlow) — they mirror the CLI reference exactly. Add features
  by adding states, never by restructuring.
- **`BrowserHtlcManager`'s wallet-polling + semver check** — the only way to
  coexist with Lace's version churn.
- **bech32m decoding pipeline in `key-encoding.ts`** — Landmine #1. Never
  bypass.
- **Safety checks in the taker flows** — `bobMinCardanoWindowSecs`,
  `bobSafetyBufferSecs`, `bobMinDepositTtlSecs`, `reverseTakerDeadlineMin`.
  Tune via `VITE_*` env vars, don't remove.
- **Orchestrator-as-advisory model** — chain state is always authoritative;
  every orchestrator call wraps with `tryOrchestrator()` and falls back.
- **The contract split** (htlc + usdc) — don't join them.
- **`watchForCardanoLock` filter signature** — must pass `(receiverPkh,
  hashHex, deadline > now)` to avoid latching onto stale UTxOs.
- **Share URL parameter names** — existing URLs in the wild use these
  exact names for forward flow (`hash`, `aliceCpk`, `aliceUnshielded`,
  `cardanoDeadlineMs`, `adaAmount`, `usdcAmount`, `role=bob`) and reverse
  flow (`hash`, `direction=usdc-ada`, `makerPkh`, `midnightDeadlineMs`,
  `adaAmount`, `usdcAmount`). Keep them even if you rename internal vars.
- **Verify-on-error patterns in deposit paths** — they catch the Lace quirk
  (Landmine #5). Don't strip them.
- **Blockfrost index-visibility gate in reverse maker's `waiting-cardano`
  effect** — prevents the Claim button from appearing during the UTxO-index
  lag (Landmine #6).

### G. Production concerns (not UI-design territory but worth flagging)

- **Blockfrost key in client bundle** — proxy for mainnet.
- **Bundle size** — `@midnight-ntwrk/*` + `@lucid-evolution/lucid` + MUI +
  qrcode.react is heavy. No tree-shake audit has been done.
- **Orchestrator single-instance** — `better-sqlite3` + local file. Horizontal
  scale needs Postgres + leader-elected watcher worker.
- **CORS origins** — orchestrator allows `localhost:{5199,5173,8080}`.
- **USDC `mint()` has no access control** — gated-deploy for mainnet.
- **Preimage in `localStorage`** — would want wallet-derived encryption
  for real-money use.
- **Reverse-flow contract simplification** (drop `receiverAuth`) — see
  `contract.md`. Saves the UX of asking for two Midnight keys. Accepts a
  mempool-front-run griefing attack that can burn the honest party's gas
  but can't steal funds.

## 15. Key files to read first (for the frontend-designer session)

1. `htlc-ui/src/components/swap/SwapCard.tsx` — the centrepiece; understand
   how role × flowDirection × state drives every piece of the card.
2. `htlc-ui/src/components/swap/SwapProgressModal.tsx` — four phase-builders,
   one for each (role, flow) combination.
3. `htlc-ui/src/components/swap/{useMakerFlow,useTakerFlow,useReverseMakerFlow,useReverseTakerFlow}.ts`
   — state machines. Don't refactor; add states.
4. `htlc-ui/src/config/theme.ts` — the palette and MUI component overrides.
   Every component reads from `theme.custom`.
5. `htlc-ui/src/config/limits.ts` — runtime-tunable safety windows.
6. `htlc-ui/src/components/WalletMenu.tsx` — wallet pill + key-bundle copy.
7. `htlc-ui/src/components/{Browse,Activity,Reclaim,RecoveryBanner}.tsx` —
   direction-aware list-driven surfaces.
8. `htlc-ui/src/api/{htlc-api,cardano-htlc-browser,orchestrator-client}.ts` —
   tx-submission surface + the Blockfrost `findClaimPreimage` helper.
9. `htlc-orchestrator/src/{types,db,routes/swaps,midnight-watcher,cardano-watcher}.ts`
   — if a UI surface depends on orchestrator fields, the semantics live here.
10. `contract.md` + `credit.md` — standing design decisions / attributions.

---

## Appendix: environment variables

### `htlc-ui/.env.preprod`

```bash
VITE_NETWORK_ID=preprod
VITE_LOGGING_LEVEL=trace
VITE_PROOF_SERVER_URI=http://127.0.0.1:6300
VITE_BLOCKFROST_API_KEY=preprod…
VITE_ORCHESTRATOR_URL=http://localhost:4000

# Optional safety-window overrides (defaults in src/config/limits.ts are
# intentionally generous — uncomment these for quick demo runs)
# VITE_ALICE_MIN_DEADLINE_MIN=3
# VITE_ALICE_DEFAULT_DEADLINE_MIN=10
# VITE_BOB_MIN_CARDANO_WINDOW_SECS=60
# VITE_BOB_SAFETY_BUFFER_SECS=30
# VITE_BOB_DEADLINE_MIN=3
# VITE_REVERSE_TAKER_DEADLINE_MIN=3
# VITE_BOB_MIN_DEPOSIT_TTL_SECS=60
# VITE_BROWSE_MIN_REMAINING_SECS=60
# VITE_WALLET_POPUP_HINT_MS=3000
```

### `htlc-orchestrator` env

```bash
PORT=4000
DATABASE_PATH=./data/swaps.db
SWAP_STATE_PATH=../htlc-ft-cli/swap-state.json
BLOCKFROST_API_KEY=…                            # server-side; NOT shipped to clients
MIDNIGHT_NETWORK=preprod

# Optional stuck-swap alerter
STUCK_SWAP_WEBHOOK_URL=…                        # Slack / Discord / raw JSON
STUCK_SWAP_SCAN_INTERVAL_MS=60000
STUCK_SWAP_ALICE_CLAIMED_STALE_MS=900000        # 15 min
STUCK_SWAP_REALERT_MS=21600000                  # 6 h
STUCK_SWAP_PUBLIC_UI_URL=https://…              # deep-link into /reclaim
```
