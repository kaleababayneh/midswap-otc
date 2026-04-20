/**
 * Midnight on-chain watcher for HTLC state changes (split HTLC contract).
 *
 * Watches the Midnight indexer for:
 *   - New HTLC deposits (Bob deposits USDC)
 *   - Preimage reveals (Alice claims USDC, revealing preimage on-chain)
 */

import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { type PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { ledger } from '../../contract/src/managed/htlc/contract/index.js';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Poll the Midnight contract state until an HTLC deposit appears for the given hash.
 * Returns the deposit details when found.
 */
export async function watchForHTLCDeposit(
  publicDataProvider: PublicDataProvider,
  contractAddress: ContractAddress,
  hashLock: Uint8Array,
  pollIntervalMs = 5000,
): Promise<{
  amount: bigint;
  expiry: bigint;
  color: Uint8Array;
  senderAuth: Uint8Array;
  receiverAuth: Uint8Array;
}> {
  const hashHex = bytesToHex(hashLock);
  console.log(`  Watching Midnight for HTLC deposit (hash: ${hashHex.slice(0, 16)}...)...`);

  while (true) {
    try {
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (state) {
        const l = ledger(state.data);
        if (l.htlcAmounts.member(hashLock) && l.htlcAmounts.lookup(hashLock) > 0n) {
          return {
            amount: l.htlcAmounts.lookup(hashLock),
            expiry: l.htlcExpiries.lookup(hashLock),
            color: l.htlcColors.lookup(hashLock),
            senderAuth: l.htlcSenderAuth.lookup(hashLock),
            receiverAuth: l.htlcReceiverAuth.lookup(hashLock),
          };
        }
      }
    } catch {
      // Indexer may be temporarily unavailable
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Poll the Midnight contract state until a preimage is revealed for the given hash.
 * After Alice calls withdrawWithPreimage, the contract stores the preimage
 * in the revealedPreimages ledger map, making it publicly observable.
 */
export async function watchForPreimageReveal(
  publicDataProvider: PublicDataProvider,
  contractAddress: ContractAddress,
  hashLock: Uint8Array,
  pollIntervalMs = 5000,
): Promise<Uint8Array> {
  const hashHex = bytesToHex(hashLock);
  console.log(`  Watching Midnight for preimage reveal (hash: ${hashHex.slice(0, 16)}...)...`);

  while (true) {
    try {
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (state) {
        const l = ledger(state.data);
        if (l.revealedPreimages.member(hashLock)) {
          const preimage = l.revealedPreimages.lookup(hashLock);
          console.log(`  Preimage revealed on-chain: ${bytesToHex(preimage)}`);
          return preimage;
        }
      }
    } catch {
      // Indexer may be temporarily unavailable
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Check if a specific HTLC is still active (has funds escrowed).
 */
export async function isHTLCActive(
  publicDataProvider: PublicDataProvider,
  contractAddress: ContractAddress,
  hashLock: Uint8Array,
): Promise<boolean> {
  const state = await publicDataProvider.queryContractState(contractAddress);
  if (!state) return false;
  const l = ledger(state.data);
  return l.htlcAmounts.member(hashLock) && l.htlcAmounts.lookup(hashLock) > 0n;
}
