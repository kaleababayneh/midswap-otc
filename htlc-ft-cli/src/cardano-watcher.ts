/**
 * Cardano on-chain watcher for HTLC UTxOs.
 *
 * Watches Blockfrost for:
 *   - New HTLC locks at the script address (Alice locks ADA)
 *   - HTLC claims/reclaims (UTxO consumed)
 */

import { type CardanoHTLC } from './cardano-htlc';

export interface CardanoHTLCInfo {
  hashHex: string;
  amountLovelace: bigint;
  deadlineMs: bigint;
  senderPkh: string;
  receiverPkh: string;
}

/**
 * Poll Cardano for new HTLC UTxOs at the script address.
 * Optionally filter by receiver PKH (to find HTLCs addressed to a specific party)
 * and/or by preimage hash (to lock onto a specific counterparty-provided HTLC).
 * The hash filter is critical when the script address holds concurrent locks:
 * without it the watcher might latch onto the wrong UTxO.
 */
export async function watchForCardanoLock(
  cardanoHtlc: CardanoHTLC,
  receiverPkh?: string,
  pollIntervalMs = 10_000,
  hashHex?: string,
): Promise<CardanoHTLCInfo> {
  console.log('  Watching Cardano for HTLC locks...');
  if (hashHex) console.log(`  Filtering by preimage hash: ${hashHex.slice(0, 16)}...`);

  const seen = new Set<string>();

  while (true) {
    try {
      const htlcs = await cardanoHtlc.listHTLCs();

      for (const { utxo, datum } of htlcs) {
        const key = `${utxo.txHash}#${utxo.outputIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Filter by receiver if specified
        if (receiverPkh && datum.receiver !== receiverPkh) continue;

        // Filter by hash if specified — binds this watcher to a specific
        // counterparty-declared preimage hash, preventing race conditions
        // where a different concurrent HTLC at the shared script address
        // could be picked up instead of the one we're actually swapping.
        if (hashHex && datum.preimageHash !== hashHex) continue;

        // Skip stale HTLCs whose deadline is already in the past — they're
        // reclaimable by the sender, not swappable. Orphans from prior runs
        // at the script address would otherwise poison fresh swap flows.
        if (datum.deadline <= BigInt(Date.now())) continue;

        const info: CardanoHTLCInfo = {
          hashHex: datum.preimageHash,
          amountLovelace: utxo.assets.lovelace ?? 0n,
          deadlineMs: datum.deadline,
          senderPkh: datum.sender,
          receiverPkh: datum.receiver,
        };

        console.log(`  Found HTLC lock on Cardano!`);
        console.log(`    Hash:     ${info.hashHex}`);
        console.log(`    Amount:   ${Number(info.amountLovelace) / 1_000_000} ADA`);
        console.log(`    Deadline: ${new Date(Number(info.deadlineMs)).toISOString()}`);
        console.log(`    Sender:   ${info.senderPkh}`);
        console.log(`    Receiver: ${info.receiverPkh}`);

        return info;
      }
    } catch {
      // Blockfrost may be temporarily unavailable
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Wait until a specific HTLC UTxO is consumed (claimed or reclaimed).
 */
export async function waitForCardanoHTLCConsumed(
  cardanoHtlc: CardanoHTLC,
  hashHex: string,
  pollIntervalMs = 10_000,
): Promise<void> {
  console.log(`  Waiting for Cardano HTLC to be consumed (hash: ${hashHex.slice(0, 16)}...)...`);

  while (true) {
    try {
      const htlcs = await cardanoHtlc.listHTLCs();
      const found = htlcs.find((h) => h.datum.preimageHash === hashHex);
      if (!found) {
        console.log('  Cardano HTLC consumed (claimed or reclaimed).');
        return;
      }
    } catch {
      // Blockfrost may be temporarily unavailable
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}
