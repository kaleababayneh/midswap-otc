export type SwapStatus =
  | 'open'
  | 'bob_deposited'
  | 'alice_claimed'
  | 'completed'
  | 'alice_reclaimed'
  | 'bob_reclaimed'
  | 'expired';

export interface Swap {
  hash: string;

  aliceCpk: string;
  aliceUnshielded: string;
  adaAmount: string;
  usdcAmount: string;
  cardanoDeadlineMs: number;
  cardanoLockTx: string;

  bobCpk: string | null;
  bobUnshielded: string | null;
  bobPkh: string | null;
  midnightDeadlineMs: number | null;
  midnightDepositTx: string | null;

  midnightClaimTx: string | null;
  cardanoClaimTx: string | null;
  cardanoReclaimTx: string | null;
  midnightReclaimTx: string | null;

  status: SwapStatus;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSwapBody {
  hash: string;
  aliceCpk: string;
  aliceUnshielded: string;
  adaAmount: string;
  usdcAmount: string;
  cardanoDeadlineMs: number;
  cardanoLockTx: string;
  /** PKH Alice committed to on-chain as the only valid receiver. Bob must match this PKH to claim. */
  bobPkh: string;
}

export interface PatchSwapBody {
  bobCpk?: string;
  bobUnshielded?: string;
  bobPkh?: string;
  midnightDeadlineMs?: number;
  midnightDepositTx?: string;
  midnightClaimTx?: string;
  cardanoClaimTx?: string;
  cardanoReclaimTx?: string;
  midnightReclaimTx?: string;
  status?: SwapStatus;
}
