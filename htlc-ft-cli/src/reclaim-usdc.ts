/**
 * Bob's Midnight USDC reclaim — recover USDC trapped in the HTLC after
 * Bob's Midnight deadline passes without Alice having withdrawn.
 *
 * In the happy path, Alice calls withdrawWithPreimage before Bob's deadline
 * and Bob picks up the preimage from `revealedPreimages` to claim ADA. If
 * Alice fails (or refuses) to withdraw, Bob's USDC stays escrowed under
 * `htlcAmounts[hash]` until Bob's deadline passes, then he calls
 * reclaimAfterExpiry(hash) to get it back.
 *
 * Usage:
 *   npx tsx src/reclaim-usdc.ts                 # reads hash from pending-swap.json
 *   npx tsx src/reclaim-usdc.ts --hash <hex>    # explicit hash
 *   SWAP_HASH=<hex> npx tsx src/reclaim-usdc.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocket } from 'ws';
import { createLogger } from './logger-utils.js';
import { MidnightWalletProvider } from './midnight-wallet-provider';
import { waitForUnshieldedFunds } from './wallet-utils';
import { generateDust } from './generate-dust';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { unshieldedToken } from '@midnight-ntwrk/ledger-v8';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { getMidnightEnv, applyMidnightNetwork } from './config';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CompiledHTLCContract,
  htlcPrivateStateKey,
  type HTLCProviders,
  type HTLCPrivateStateId,
  type EmptyPrivateState,
  type HTLCCircuitKeys,
} from '../../contract/src/htlc-contract';
import { ledger as htlcLedger } from '../../contract/src/managed/htlc/contract/index.js';

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

const scriptDir = path.resolve(new URL(import.meta.url).pathname, '..');

const env: EnvironmentConfiguration = getMidnightEnv();

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildHtlcProviders(wp: MidnightWalletProvider, seed: string): HTLCProviders {
  const zkConfigPath = path.resolve(scriptDir, '..', '..', 'contract', 'src', 'managed', 'htlc');
  const zk = new NodeZkConfigProvider<HTLCCircuitKeys>(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider<HTLCPrivateStateId, EmptyPrivateState>({
      privateStateStoreName: 'htlc-bob-reclaim',
      signingKeyStoreName: 'htlc-bob-reclaim-keys',
      privateStoragePasswordProvider: () => 'Htlc-Bob-Reclaim-2026!',
      accountId: seed,
    }),
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider: zk,
    proofProvider: httpClientProofProvider(env.proofServer, zk),
    walletProvider: wp,
    midnightProvider: wp,
  };
}

function resolveHashHex(): string {
  const hashArgIdx = process.argv.indexOf('--hash');
  if (hashArgIdx >= 0 && process.argv[hashArgIdx + 1]) return process.argv[hashArgIdx + 1];
  if (process.env.SWAP_HASH) return process.env.SWAP_HASH;
  const pendingPath = path.resolve(scriptDir, '..', 'pending-swap.json');
  if (fs.existsSync(pendingPath)) {
    const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    if (typeof pending.hashHex === 'string') return pending.hashHex;
  }
  console.error(
    'ERROR: no hash provided. Pass --hash <hex>, set SWAP_HASH, or ensure pending-swap.json has hashHex.',
  );
  process.exit(1);
}

async function main() {
  applyMidnightNetwork();

  const addressPath = path.resolve(scriptDir, '..', 'address.json');
  const addresses = JSON.parse(fs.readFileSync(addressPath, 'utf-8'));
  const swapStatePath = path.resolve(scriptDir, '..', 'swap-state.json');
  if (!fs.existsSync(swapStatePath)) {
    console.error('ERROR: swap-state.json not found. Run setup-contract.ts first.');
    process.exit(1);
  }
  const swapState = JSON.parse(fs.readFileSync(swapStatePath, 'utf-8'));

  const hashHex = resolveHashHex();
  const hashBytes = hexToBytes(hashHex);
  if (hashBytes.length !== 32) {
    console.error(`ERROR: hash must be 32 bytes (64 hex chars), got ${hashBytes.length} bytes`);
    process.exit(1);
  }

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      BOB — Midnight USDC Reclaim (after expiry)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`HTLC Contract: ${swapState.htlcContractAddress}`);
  console.log(`Hash:          ${hashHex}\n`);

  const logDir = path.resolve(scriptDir, '..', 'logs', 'reclaim-usdc', `${new Date().toISOString()}.log`);
  const logger = await createLogger(logDir);

  // Pre-flight: query contract state so we can fail fast without spinning up the wallet
  // on bogus input (wrong hash / already reclaimed / not expired yet).
  console.log('── Pre-flight: checking HTLC state ──');
  const publicDataProvider = indexerPublicDataProvider(env.indexer, env.indexerWS);
  const preState = await publicDataProvider.queryContractState(
    swapState.htlcContractAddress as ContractAddress,
  );
  if (!preState) {
    console.error('ERROR: HTLC contract state not found at', swapState.htlcContractAddress);
    process.exit(1);
  }
  const preLedger = htlcLedger(preState.data);
  if (!preLedger.htlcAmounts.member(hashBytes)) {
    console.error(`ERROR: no HTLC entry for hash ${hashHex.slice(0, 16)}...`);
    process.exit(1);
  }
  const amount = preLedger.htlcAmounts.lookup(hashBytes);
  if (amount === 0n) {
    console.log('HTLC already completed (htlcAmounts sentinel is 0). Nothing to reclaim.');
    process.exit(0);
  }
  const expirySecs = preLedger.htlcExpiries.lookup(hashBytes);
  const expiryMs = Number(expirySecs) * 1000;
  const nowMs = Date.now();
  const color = bytesToHex(preLedger.htlcColors.lookup(hashBytes));
  console.log(`  Amount:   ${amount}`);
  console.log(`  Color:    ${color.slice(0, 20)}... (${color === swapState.usdcColor ? 'USDC' : 'other token'})`);
  console.log(`  Expiry:   ${new Date(expiryMs).toISOString()}`);
  console.log(`  Now:      ${new Date(nowMs).toISOString()}`);
  if (nowMs <= expiryMs) {
    const remainingMin = Math.ceil((expiryMs - nowMs) / 60_000);
    console.error(
      `ERROR: HTLC has not expired yet (${remainingMin} min remaining). ` +
        `Wait until ${new Date(expiryMs).toISOString()} before reclaiming.`,
    );
    process.exit(1);
  }
  console.log('  Expired — eligible for reclaim.\n');

  // Record stored sender auth for the post-wallet check below. Reclaim succeeds
  // iff the wallet's RUNTIME ownPublicKey().bytes == this stored value.
  // Comparing against address.json here would be misleading (that field is
  // known to drift from the runtime key; see alice-swap.ts).
  const storedSenderAuth = bytesToHex(preLedger.htlcSenderAuth.lookup(hashBytes));
  console.log(`  Sender auth: ${storedSenderAuth.slice(0, 16)}... (Bob's runtime key at deposit time)`);

  // Build Bob's wallet
  console.log('── Building Bob\'s wallet ──');
  const bobSeed = addresses.bob.midnight.seed;
  const wp = await MidnightWalletProvider.build(logger, env, bobSeed);
  await wp.start();
  const unshielded = await waitForUnshieldedFunds(logger, wp.wallet, env, unshieldedToken());
  await generateDust(logger, bobSeed, unshielded, wp.wallet);

  const bobRuntimeCoinPublicKey = wp.getCoinPublicKey();
  console.log(`Bob coinPublicKey (runtime): ${bobRuntimeCoinPublicKey}`);
  if (bobRuntimeCoinPublicKey !== storedSenderAuth) {
    console.warn(
      `  WARNING: runtime coinPublicKey ${bobRuntimeCoinPublicKey.slice(0, 16)}... ` +
        `differs from stored sender auth ${storedSenderAuth.slice(0, 16)}... — ` +
        `reclaim will fail the "Only original sender" assertion. ` +
        `This wallet did not create the deposit.`,
    );
  }

  console.log('\nJoining HTLC contract...');
  const providers = buildHtlcProviders(wp, bobSeed);
  const contract = await findDeployedContract(providers, {
    contractAddress: swapState.htlcContractAddress as ContractAddress,
    compiledContract: CompiledHTLCContract,
    privateStateId: htlcPrivateStateKey,
    initialPrivateState: {} as EmptyPrivateState,
  });
  console.log('Joined HTLC contract.\n');

  console.log('── Calling reclaimAfterExpiry ──');
  console.log(`Reclaiming ${amount} USDC under hash ${hashHex.slice(0, 16)}...`);
  await contract.callTx.reclaimAfterExpiry(hashBytes);
  console.log('Reclaim submitted!');

  // Verify sentinel
  console.log('\nVerifying sentinel (htlcAmounts[hash] == 0)...');
  const postState = await providers.publicDataProvider.queryContractState(
    swapState.htlcContractAddress as ContractAddress,
  );
  if (!postState) throw new Error('HTLC state not found after reclaim');
  const postLedger = htlcLedger(postState.data);
  const remaining = postLedger.htlcAmounts.member(hashBytes)
    ? postLedger.htlcAmounts.lookup(hashBytes)
    : -1n;
  console.log(`  htlcAmounts[hash] = ${remaining}`);
  if (remaining !== 0n) {
    console.error(`ERROR: expected 0 after reclaim, got ${remaining}`);
    process.exit(1);
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              USDC RECLAIM COMPLETE                      ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Amount:   ${amount} USDC (native)`);
  console.log(`║  Hash:     ${hashHex.slice(0, 32)}...`);
  console.log('╚══════════════════════════════════════════════════════════╝');

  await wp.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('Reclaim failed:', e);
  process.exit(1);
});
