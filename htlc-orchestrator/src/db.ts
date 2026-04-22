import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreateSwapBody, PatchSwapBody, Swap, SwapStatus } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SwapRow {
  hash: string;
  alice_cpk: string;
  alice_unshielded: string;
  ada_amount: string;
  usdc_amount: string;
  cardano_deadline_ms: number;
  cardano_lock_tx: string;
  bob_cpk: string | null;
  bob_unshielded: string | null;
  bob_pkh: string | null;
  midnight_deadline_ms: number | null;
  midnight_deposit_tx: string | null;
  midnight_claim_tx: string | null;
  cardano_claim_tx: string | null;
  cardano_reclaim_tx: string | null;
  midnight_reclaim_tx: string | null;
  midnight_preimage: string | null;
  status: SwapStatus;
  created_at: number;
  updated_at: number;
}

const rowToSwap = (row: SwapRow): Swap => ({
  hash: row.hash,
  aliceCpk: row.alice_cpk,
  aliceUnshielded: row.alice_unshielded,
  adaAmount: row.ada_amount,
  usdcAmount: row.usdc_amount,
  cardanoDeadlineMs: row.cardano_deadline_ms,
  cardanoLockTx: row.cardano_lock_tx,
  bobCpk: row.bob_cpk,
  bobUnshielded: row.bob_unshielded,
  bobPkh: row.bob_pkh,
  midnightDeadlineMs: row.midnight_deadline_ms,
  midnightDepositTx: row.midnight_deposit_tx,
  midnightClaimTx: row.midnight_claim_tx,
  cardanoClaimTx: row.cardano_claim_tx,
  cardanoReclaimTx: row.cardano_reclaim_tx,
  midnightReclaimTx: row.midnight_reclaim_tx,
  midnightPreimage: row.midnight_preimage,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface SwapStore {
  create(body: CreateSwapBody): Swap;
  get(hash: string): Swap | undefined;
  list(filter?: { status?: SwapStatus }): Swap[];
  patch(hash: string, body: PatchSwapBody): Swap | undefined;
  close(): void;
}

export const openSwapStore = (dbPath: string): SwapStore => {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(resolve(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const existingCols = db.prepare('PRAGMA table_info(swaps)').all() as Array<{ name: string }>;
  if (!existingCols.some((c) => c.name === 'midnight_preimage')) {
    db.exec('ALTER TABLE swaps ADD COLUMN midnight_preimage TEXT');
  }

  const insertStmt = db.prepare(`
    INSERT INTO swaps (
      hash, alice_cpk, alice_unshielded, ada_amount, usdc_amount,
      cardano_deadline_ms, cardano_lock_tx, bob_pkh,
      status, created_at, updated_at
    ) VALUES (
      @hash, @aliceCpk, @aliceUnshielded, @adaAmount, @usdcAmount,
      @cardanoDeadlineMs, @cardanoLockTx, @bobPkh,
      'open', @now, @now
    )
  `);

  const getStmt = db.prepare<[string], SwapRow>('SELECT * FROM swaps WHERE hash = ?');
  const listAllStmt = db.prepare<[], SwapRow>('SELECT * FROM swaps ORDER BY created_at DESC');
  const listByStatusStmt = db.prepare<[SwapStatus], SwapRow>(
    'SELECT * FROM swaps WHERE status = ? ORDER BY created_at DESC',
  );

  const patchableColumns: Record<keyof PatchSwapBody, string> = {
    bobCpk: 'bob_cpk',
    bobUnshielded: 'bob_unshielded',
    bobPkh: 'bob_pkh',
    midnightDeadlineMs: 'midnight_deadline_ms',
    midnightDepositTx: 'midnight_deposit_tx',
    midnightClaimTx: 'midnight_claim_tx',
    cardanoClaimTx: 'cardano_claim_tx',
    cardanoReclaimTx: 'cardano_reclaim_tx',
    midnightReclaimTx: 'midnight_reclaim_tx',
    midnightPreimage: 'midnight_preimage',
    status: 'status',
  };

  return {
    create(body) {
      const now = Date.now();
      insertStmt.run({ ...body, now });
      const row = getStmt.get(body.hash);
      if (!row) throw new Error('insert succeeded but row not found');
      return rowToSwap(row);
    },

    get(hash) {
      const row = getStmt.get(hash);
      return row ? rowToSwap(row) : undefined;
    },

    list(filter) {
      const rows = filter?.status ? listByStatusStmt.all(filter.status) : listAllStmt.all();
      return rows.map(rowToSwap);
    },

    patch(hash, body) {
      const setClauses: string[] = [];
      const params: Record<string, unknown> = { hash, now: Date.now() };

      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        const column = patchableColumns[key as keyof PatchSwapBody];
        if (!column) continue;
        setClauses.push(`${column} = @${key}`);
        params[key] = value;
      }

      if (setClauses.length === 0) {
        return this.get(hash);
      }

      setClauses.push('updated_at = @now');
      const sql = `UPDATE swaps SET ${setClauses.join(', ')} WHERE hash = @hash`;
      const result = db.prepare(sql).run(params);
      if (result.changes === 0) return undefined;
      return this.get(hash);
    },

    close() {
      db.close();
    },
  };
};
