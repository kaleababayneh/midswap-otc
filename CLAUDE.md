# Cross-Chain Atomic Swap: Midnight (USDC) <-> Cardano (ADA)

## What This Project Is

A fully working cross-chain atomic swap between **Midnight** (privacy-focused L1) and **Cardano** (Preprod testnet). Alice trades ADA for USDC tokens, Bob trades USDC for ADA. Neither party can cheat — the swap is trustless via hash-time lock contracts (HTLCs) on both chains.

**The swap has been successfully executed end-to-end** on Cardano Preprod + Midnight local dev using `execute-swap.ts`.

## Project Layout

```
example-bboard/
├── contract/                    # Midnight smart contracts (Compact language)
│   ├── src/
│   │   ├── htlc-ft.compact           # HTLC + FungibleToken combined contract (THE main contract)
│   │   ├── usdc.compact              # Standalone USDC token (NEW, compiled, not yet integrated)
│   │   ├── htlc-ft-contract.ts       # TypeScript wrapper for htlc-ft
│   │   ├── usdc-contract.ts          # TypeScript wrapper for usdc (NEW)
│   │   ├── managed/htlc-ft/          # Compiled HTLC-FT artifacts (prover/verifier keys, ZKIR)
│   │   ├── managed/usdc/             # Compiled USDC artifacts
│   │   └── vendor/openzeppelin/      # OpenZeppelin FungibleToken standard
│   └── package.json
│
├── htlc-ft-cli/                 # CLI tools for running swaps
│   ├── src/
│   │   ├── execute-swap.ts           # Automated end-to-end swap (WORKS, ran successfully)
│   │   ├── alice-swap.ts             # Alice's standalone flow (NEW, needs alignment)
│   │   ├── bob-swap.ts               # Bob's standalone flow (NEW, needs alignment)
│   │   ├── setup-contract.ts         # Deploy both contracts (NEW, needs alignment)
│   │   ├── mint-usdc.ts              # Mint USDC tokens (NEW, needs alignment)
│   │   ├── midnight-watcher.ts       # Watch Midnight indexer for deposits/preimage reveals (NEW)
│   │   ├── cardano-watcher.ts        # Watch Cardano via Blockfrost for HTLC locks (NEW)
│   │   ├── cardano-htlc.ts           # Cardano HTLC off-chain module (Lucid Evolution)
│   │   ├── index.ts                  # Interactive CLI menu (original, modified)
│   │   ├── config.ts                 # Environment config (local dev + preprod)
│   │   ├── midnight-wallet-provider.ts
│   │   ├── wallet-utils.ts
│   │   ├── generate-dust.ts          # Dust generation for Midnight tx fees
│   │   ├── mint-tnight.ts            # Mint tNight to wallets
│   │   ├── generate-keys.ts          # Generate Alice/Bob/Charlie key pairs
│   │   ├── check-balance.ts          # Check Cardano ADA balance
│   │   ├── check-midnight-balance.ts # Check Midnight balance
│   │   └── send-ada.ts               # Send ADA between wallets
│   ├── address.json                  # Alice/Bob/Charlie addresses (both chains)
│   └── .env                          # BLOCKFROST_API_KEY
│
└── cardano/                     # Cardano validators (Aiken language)
    ├── validators/
    │   ├── htlc.ak                   # HTLC spending validator
    │   └── swap_token.ak             # One-shot minting policy
    ├── lib/htlc/                     # Types and validation logic
    └── plutus.json                   # Compiled Plutus blueprint
```

## How the Atomic Swap Works

```
Alice has ADA on Cardano, wants USDC on Midnight.
Bob has USDC on Midnight, wants ADA on Cardano.

1. Alice generates a random 32-byte PREIMAGE and computes HASH = SHA256(PREIMAGE)
2. Alice locks ADA on Cardano HTLC (keyed by HASH, deadline = 2 hours, receiver = Bob)
3. Bob watches Cardano, sees Alice's lock, discovers the HASH
4. Bob deposits USDC on Midnight HTLC (same HASH, deadline = 1 hour, receiver = Alice)
   - Bob's deadline MUST be shorter than Alice's (prevents race conditions)
5. Alice claims USDC on Midnight by calling withdrawWithPreimage(PREIMAGE)
   - This reveals the PREIMAGE on-chain
6. Bob watches Midnight, reads the revealed PREIMAGE from contract state
7. Bob claims ADA on Cardano using the same PREIMAGE
   - Cardano validates: SHA256(PREIMAGE) == HASH in datum

Result: Alice got USDC, Bob got ADA. Neither could cheat.
If either side times out, funds are reclaimable by the original sender.
```

## The HTLC-FT Contract (Midnight Side)

**File:** `contract/src/htlc-ft.compact`

This is the main contract. It combines OpenZeppelin's FungibleToken (ERC20-like) with HTLC swap logic. Midnight has **no cross-contract calls**, so the token and swap logic MUST live in the same contract.

**Constructor:** `constructor(tokenName, tokenSymbol, tokenDecimals)` — initializes the FungibleToken.

**Token circuits** (delegated to FT module):
- `myAddr()` — returns caller's 32-byte public key
- `totalSupply()` — total minted supply
- `balanceOf(account)` — balance of an address (uses `Either<ZswapCoinPublicKey, ContractAddress>`)
- `transfer(to, value)` — transfer tokens between users
- `approve(spender, value)` — approve spending allowance
- `mint(account, value)` — mint new tokens

**HTLC circuits:**
- `depositWithHashTimeLock(amount, hash, expiryTime, receiver)` — escrow tokens under hash lock
- `withdrawWithPreimage(preimage)` — claim by revealing preimage (before deadline)
- `reclaimAfterExpiry(hash)` — refund after deadline

**Ledger state (exported, queryable via indexer):**
- `htlcAmounts: Map<Bytes<32>, Uint<128>>` — escrowed amount per hash
- `htlcExpiries: Map<Bytes<32>, Uint<64>>` — expiry timestamp per hash
- `htlcSenders: Map<Bytes<32>, Bytes<32>>` — sender per hash
- `htlcReceivers: Map<Bytes<32>, Bytes<32>>` — receiver per hash

**How escrow works internally:**
- `depositWithHashTimeLock`: calls `FT__unsafeUncheckedTransfer(caller, contractSelf, amount)` to move tokens from user's balance to contract's balance
- `withdrawWithPreimage`: calls `FT__unsafeUncheckedTransfer(contractSelf, receiver, amount)` to release tokens
- `reclaimAfterExpiry`: same as withdraw but back to sender
- Completed swaps use `amount = 0` as sentinel (Compact Maps have no delete)

## The USDC Contract (Standalone Token)

**File:** `contract/src/usdc.compact`

A separate, standalone USD Coin token contract. Pure ERC20 — no HTLC logic. Created for future architecture where tokens and swaps are managed independently.

**Status:** Compiled (managed/usdc/ exists), TypeScript wrapper created (usdc-contract.ts), but **not yet integrated into the CLI workflows**.

## The Cardano HTLC (Aiken Validator)

**File:** `cardano/validators/htlc.ak`
**Compiled:** `cardano/plutus.json`

PlutusV3 spending validator with:
- **Datum:** `{ preimageHash, sender (PKH), receiver (PKH), deadline (POSIX ms) }`
- **Redeemer:** `Withdraw { preimage }` or `Reclaim`
- **Withdraw validation:** `sha256(preimage) == datum.preimageHash`, current time < deadline, signer is receiver
- **Reclaim validation:** current time > deadline, signer is sender

The off-chain code (`htlc-ft-cli/src/cardano-htlc.ts`) uses Lucid Evolution to build/submit transactions.

## Build & Compile Process

### Compact contracts (Midnight)

```bash
cd contract

# Compile Compact -> managed artifacts (ZKIR, prover/verifier keys)
compact compile src/htlc-ft.compact ./src/managed/htlc-ft
compact compile src/usdc.compact ./src/managed/usdc

# Build TypeScript (generates dist/ with .js, .d.ts, copies managed/)
npm run build:htlc
# Which runs: rm -rf dist && tsc --project tsconfig.build.json && cp -Rf ./src/managed ./dist/managed
```

The `compact` binary is at `/Users/kaleab/.local/bin/compact`. Do NOT use `npx compact` — it won't find it.

**IMPORTANT:** After any `.compact` file change, you must:
1. `compact compile` the contract
2. Run `npm run build:htlc` (or manually: `tsc --project tsconfig.build.json && cp -Rf ./src/managed ./dist/managed`)

### NPM scripts

**Contract (`contract/package.json`):**
```
compact:htlc    # compact compile src/htlc-ft.compact ./src/managed/htlc-ft
compact:usdc    # compact compile src/usdc.compact ./src/managed/usdc
build:htlc      # Full TS build + copy managed artifacts
typecheck       # tsc --noEmit
```

**CLI (`htlc-ft-cli/package.json`):**
```
setup           # Deploy contracts + mint initial supply
mint-usdc       # Mint USDC to a participant
swap:alice      # Run Alice's swap flow
swap:bob        # Run Bob's swap flow
mint-tnight     # Mint tNight to wallets
check-balance   # Check Cardano ADA balance
check-midnight  # Check Midnight balance
typecheck       # tsc --noEmit
```

All CLI scripts run via: `node --experimental-specifier-resolution=node --loader ts-node/esm src/<script>.ts`

## Network Configuration

**Midnight (local dev, networkId: 'undeployed'):**
- Node: `http://127.0.0.1:9944` / `ws://127.0.0.1:9944`
- Indexer: `http://127.0.0.1:8088/api/v3/graphql` / `ws://127.0.0.1:8088/api/v3/graphql/ws`
- Proof Server: `http://127.0.0.1:6300`

**Cardano (Preprod testnet):**
- Blockfrost: `https://cardano-preprod.blockfrost.io/api/v0`
- API key in `.env`: `BLOCKFROST_API_KEY=preprodmt96ybDEKiQr93kJbYa8oaziBoQL1sYg`

**Previously we used Cardano Preview but it had `PPViewHashesDontMatch` errors** due to cost model mismatch in Blockfrost. Switching to Preprod fixed it.

## Wallet Funding Requirements

- **Midnight:** Each wallet needs ~1T tNight (1,000,000,000,000) for dust generation. The `additionalFeeOverhead` in local dev is 500Q (500,000,000,000,000,000n). Use `mint-tnight.ts` to fund.
- **Cardano:** Fund via Cardano Preprod faucet. Alice needs enough ADA to lock in HTLC. Bob needs ADA for transaction fees.

## Key Technical Details & Gotchas

### Compact language
- `Opaque<"string">` — values that come from the runtime (TypeScript side), opaque to Compact
- `disclose(value)` — makes a value public (visible in the transaction)
- `persistentHash<T>(value)` — SHA-256 hash, same as Cardano's on-chain SHA-256
- `ownPublicKey()` — returns caller's `ZswapCoinPublicKey`
- `kernel.self()` — returns the contract's own `ContractAddress`
- `left<A,B>(a)` / `right<A,B>(b)` — construct `Either` type
- `blockTimeLt(t)` / `blockTimeLte(t)` / `blockTimeGt(t)` — time comparisons
- Arithmetic on `Uint<128>` widens the type — use `as Uint<128>` cast after add/subtract
- Maps have no `delete()` — use sentinel values (e.g., amount = 0 for completed swaps)
- `sealed ledger` fields — can only be set once (in constructor via `initialize`)

### TypeScript wrapper pattern
```typescript
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as CompiledHTLCFT from "./managed/htlc-ft/contract/index.js";

export const CompiledHTLCFTContract = CompiledContract.make<HTLCFTContract>(
  "HtlcFt",   // Contract label — derived from filename (htlc-ft -> HtlcFt)
  CompiledHTLCFT.Contract<EmptyPrivateState>,
).pipe(
  // @ts-expect-error: Witnesses<EmptyPrivateState> = {} — no witnesses to provide
  CompiledContract.withWitnesses({}),
  CompiledContract.withCompiledFileAssets("./managed/htlc-ft"),
);
```

### Address encoding
- `encodeCoinPublicKey(hexString)` — converts a hex coin public key to `Uint8Array` (takes a string, NOT an object)
- `Either<ZswapCoinPublicKey, ContractAddress>` — used for addresses in FungibleToken operations:
  ```typescript
  // User address (left):
  { is_left: true, left: { bytes: addrBytes }, right: { bytes: new Uint8Array(32) } }
  // Contract address (right):
  { is_left: false, left: { bytes: new Uint8Array(32) }, right: { bytes: contractBytes } }
  ```

### PublicDataProvider
- **NOT a generic type** — use `PublicDataProvider`, never `PublicDataProvider<any>`
- `queryContractState(contractAddress)` returns state that you decode with `ledger(state.data)`

### Midnight indexer
- GraphQL at `http://127.0.0.1:8088/api/v3/graphql`
- WebSocket at `ws://127.0.0.1:8088/api/v3/graphql/ws`
- `contractStateObservable()` for real-time subscriptions
- `queryContractState()` for polling
- Docs: https://docs.midnight.network/relnotes/midnight-indexer

## What Was Successfully Done

1. **Built the complete HTLC-FT contract** with OpenZeppelin FungibleToken integration, concurrent swap support via Maps, and all escrow logic
2. **Built the Cardano HTLC validator** in Aiken (PlutusV3) with withdraw/reclaim redeemer support
3. **Built the Cardano off-chain module** using Lucid Evolution for lock/claim/reclaim/listHTLCs
4. **Switched from Cardano Preview to Preprod** to fix PPViewHashesDontMatch errors
5. **Funded wallets**: 1T tNight on Midnight, ADA on Cardano Preprod
6. **Successfully executed the full cross-chain atomic swap** via `execute-swap.ts`:
   - Bob deployed HTLC-FT contract, minted 100 SWAP tokens
   - Alice locked 10 ADA on Cardano HTLC
   - Bob deposited 10 SWAP on Midnight HTLC (same hash)
   - Alice claimed SWAP on Midnight (revealed preimage)
   - Bob claimed ADA on Cardano (used revealed preimage)
   - Final balances verified, HTLC status: COMPLETED
7. **Created standalone Alice/Bob swap scripts** (`alice-swap.ts`, `bob-swap.ts`) for separate-process execution
8. **Created chain watcher modules** (`midnight-watcher.ts`, `cardano-watcher.ts`) for polling on-chain state
9. **Created setup/management scripts** (`setup-contract.ts`, `mint-usdc.ts`)
10. **Created standalone USDC token contract** (`usdc.compact`) — compiled but not yet integrated

## What Still Needs To Be Done

### 1. Add `revealedPreimages` to HTLC-FT contract
The current committed `htlc-ft.compact` does NOT store revealed preimages on-chain. `withdrawWithPreimage` marks the swap complete but doesn't save the preimage for Bob to observe. This needs to be added:

```compact
// Add to ledger state:
export ledger revealedPreimages: Map<Bytes<32>, Bytes<32>>;

// Add to withdrawWithPreimage, BEFORE marking complete:
revealedPreimages.insert(hash, disclose(preimage));
```

Without this, Bob has no way to discover the preimage on-chain. The `midnight-watcher.ts` already has code to read `revealedPreimages` — it just needs the contract to actually store them.

After adding this, recompile and rebuild:
```bash
cd contract
compact compile src/htlc-ft.compact ./src/managed/htlc-ft
npm run build:htlc
```

### 2. Align CLI scripts with contract state
The new CLI scripts (`alice-swap.ts`, `bob-swap.ts`, `setup-contract.ts`, `mint-usdc.ts`) were written for a separated architecture that was reverted. They need to be reconciled:

**Option A — Keep combined htlc-ft contract (current state):**
- `setup-contract.ts` should deploy ONE contract (htlc-ft), not two
- `swap-state.json` should use `contractAddress` (not `htlcContractAddress`/`usdcContractAddress`)
- `alice-swap.ts` and `bob-swap.ts` should read `swapState.contractAddress`
- `mint-usdc.ts` should use htlc-ft contract (which has `mint`)
- The standalone USDC contract (`usdc.compact`) becomes a separate, independent deployment

**Option B — Separate HTLC from token:**
- Requires deciding how to handle escrow without cross-contract calls
- The HTLC still needs FungibleToken internally for balance tracking
- Could remove `transfer`, `approve` from HTLC (keep only swap ops + mint/balanceOf)
- Or keep HTLC-FT as-is and USDC as an independent token contract

### 3. Test the split Alice/Bob flows end-to-end
The `alice-swap.ts` and `bob-swap.ts` have never been tested together. They should be run in separate terminals to verify:
- Alice locks ADA, waits for Bob's deposit
- Bob watches Cardano, deposits USDC, watches for preimage
- Alice claims USDC (reveals preimage on Midnight)
- Bob reads preimage from Midnight, claims ADA on Cardano

### 4. Consider additional features (from earlier discussion)
- CLI menu integration for the new scripts
- Better error handling / retry logic in watchers
- Deadline safety checks (Bob's deadline must be significantly shorter than Alice's)

## Key Files to Read First

If you're picking this up fresh, read in this order:
1. `contract/src/htlc-ft.compact` — understand the contract API
2. `cardano/validators/htlc.ak` — understand the Cardano side
3. `htlc-ft-cli/src/execute-swap.ts` — the working end-to-end flow
4. `htlc-ft-cli/src/cardano-htlc.ts` — Cardano off-chain module
5. `htlc-ft-cli/src/midnight-watcher.ts` — how to read Midnight contract state
6. `htlc-ft-cli/src/alice-swap.ts` / `bob-swap.ts` — the new split flows (need alignment)
7. `contract/src/usdc.compact` — the standalone token contract (for reference)

## Running the Existing Working Swap

Prerequisites: Midnight local dev node running, Cardano Preprod Blockfrost key in `.env`, wallets funded.

```bash
# From htlc-ft-cli/
npx tsx src/execute-swap.ts
```

This deploys a fresh contract, mints tokens, and runs the full 6-step swap automatically.
