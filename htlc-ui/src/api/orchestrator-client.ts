/**
 * Typed REST client for the htlc-orchestrator backend.
 *
 * The orchestrator is an ENHANCEMENT, not a dependency of the swap protocol —
 * all calls are best-effort and log rather than throw. Chain state remains
 * authoritative; the DB only exists so Bob can discover Alice's offers
 * without a copy-pasted URL.
 */

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
  midnightPreimage: string | null;
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
  /** PKH Alice set as the only valid receiver on-chain. Only a Bob with this Eternl PKH can claim. */
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
  midnightPreimage?: string;
  status?: SwapStatus;
}

const BASE_URL = ((import.meta.env.VITE_ORCHESTRATOR_URL as string | undefined) ?? 'http://localhost:4000').replace(
  /\/$/,
  '',
);

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(`orchestrator ${init.method ?? 'GET'} ${path} → ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
};

export const orchestratorClient = {
  baseUrl: BASE_URL,

  health: () => request<{ ok: boolean; db: string }>('/health'),

  createSwap: (body: CreateSwapBody) => request<Swap>('/api/swaps', { method: 'POST', body: JSON.stringify(body) }),

  listSwaps: (status?: SwapStatus) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return request<{ swaps: Swap[] }>(`/api/swaps${qs}`);
  },

  getSwap: (hash: string) => request<Swap>(`/api/swaps/${hash}`),

  patchSwap: (hash: string, body: PatchSwapBody) =>
    request<Swap>(`/api/swaps/${hash}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

/** Fire-and-forget wrapper that swallows errors (logs to console). */
export const tryOrchestrator = async <T>(action: () => Promise<T>, label: string): Promise<T | undefined> => {
  try {
    return await action();
  } catch (e) {
    console.warn(`[orchestrator:${label}]`, e instanceof Error ? e.message : e);
    return undefined;
  }
};
