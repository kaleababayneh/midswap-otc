import type { FastifyPluginAsync } from 'fastify';
import type { SwapStore } from '../db.js';
import type { CreateSwapBody, PatchSwapBody, SwapStatus } from '../types.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const HEX_RE = /^[0-9a-f]+$/i;
const STATUS_VALUES: readonly SwapStatus[] = [
  'open',
  'bob_deposited',
  'alice_claimed',
  'completed',
  'alice_reclaimed',
  'bob_reclaimed',
  'expired',
];

const isHash = (s: unknown): s is string => typeof s === 'string' && HASH_RE.test(s);
const isHex = (s: unknown): s is string => typeof s === 'string' && HEX_RE.test(s);
const isNonEmptyString = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

const validateCreateBody = (body: unknown): CreateSwapBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  if (!isHash(b.hash)) return 'hash must be 64 lowercase hex chars';
  if (!isHex(b.aliceCpk)) return 'aliceCpk must be hex';
  if (!isNonEmptyString(b.aliceUnshielded)) return 'aliceUnshielded must be non-empty string';
  if (!isNonEmptyString(b.adaAmount)) return 'adaAmount must be decimal string';
  if (!isNonEmptyString(b.usdcAmount)) return 'usdcAmount must be decimal string';
  if (!isPosInt(b.cardanoDeadlineMs)) return 'cardanoDeadlineMs must be integer ms';
  if (!isNonEmptyString(b.cardanoLockTx)) return 'cardanoLockTx must be non-empty string';
  if (!isHex(b.bobPkh) || (b.bobPkh as string).length !== 56) return 'bobPkh must be 56 hex chars';
  return {
    hash: b.hash,
    aliceCpk: b.aliceCpk.toLowerCase(),
    aliceUnshielded: b.aliceUnshielded,
    adaAmount: b.adaAmount,
    usdcAmount: b.usdcAmount,
    cardanoDeadlineMs: b.cardanoDeadlineMs,
    cardanoLockTx: b.cardanoLockTx,
    bobPkh: b.bobPkh.toLowerCase(),
  };
};

const validatePatchBody = (body: unknown): PatchSwapBody | string => {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const out: PatchSwapBody = {};

  if (b.bobCpk !== undefined) {
    if (!isHex(b.bobCpk)) return 'bobCpk must be hex';
    out.bobCpk = (b.bobCpk as string).toLowerCase();
  }
  if (b.bobUnshielded !== undefined) {
    if (!isNonEmptyString(b.bobUnshielded)) return 'bobUnshielded must be string';
    out.bobUnshielded = b.bobUnshielded;
  }
  if (b.bobPkh !== undefined) {
    if (!isHex(b.bobPkh)) return 'bobPkh must be hex';
    out.bobPkh = (b.bobPkh as string).toLowerCase();
  }
  if (b.midnightDeadlineMs !== undefined) {
    if (!isPosInt(b.midnightDeadlineMs)) return 'midnightDeadlineMs must be integer ms';
    out.midnightDeadlineMs = b.midnightDeadlineMs;
  }
  for (const field of [
    'midnightDepositTx',
    'midnightClaimTx',
    'cardanoClaimTx',
    'cardanoReclaimTx',
    'midnightReclaimTx',
  ] as const) {
    if (b[field] !== undefined) {
      if (!isNonEmptyString(b[field])) return `${field} must be non-empty string`;
      out[field] = b[field] as string;
    }
  }
  if (b.midnightPreimage !== undefined) {
    if (!isHash(b.midnightPreimage)) return 'midnightPreimage must be 64 lowercase hex chars';
    out.midnightPreimage = b.midnightPreimage;
  }
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !STATUS_VALUES.includes(b.status as SwapStatus)) {
      return `status must be one of: ${STATUS_VALUES.join(', ')}`;
    }
    out.status = b.status as SwapStatus;
  }
  return out;
};

export const swapsRoutes = (store: SwapStore): FastifyPluginAsync => async (app) => {
  app.post('/swaps', async (req, reply) => {
    const parsed = validateCreateBody(req.body);
    if (typeof parsed === 'string') {
      return reply.code(400).send({ error: parsed });
    }
    if (store.get(parsed.hash)) {
      return reply.code(409).send({ error: 'swap with this hash already exists' });
    }
    const swap = store.create(parsed);
    return reply.code(201).send(swap);
  });

  app.get<{ Querystring: { status?: string } }>('/swaps', async (req, reply) => {
    const { status } = req.query;
    if (status !== undefined && !STATUS_VALUES.includes(status as SwapStatus)) {
      return reply.code(400).send({ error: `status must be one of: ${STATUS_VALUES.join(', ')}` });
    }
    const swaps = store.list(status ? { status: status as SwapStatus } : undefined);
    return reply.send({ swaps });
  });

  app.get<{ Params: { hash: string } }>('/swaps/:hash', async (req, reply) => {
    const { hash } = req.params;
    if (!isHash(hash)) {
      return reply.code(400).send({ error: 'hash must be 64 lowercase hex chars' });
    }
    const swap = store.get(hash);
    if (!swap) return reply.code(404).send({ error: 'swap not found' });
    return reply.send(swap);
  });

  app.patch<{ Params: { hash: string } }>('/swaps/:hash', async (req, reply) => {
    const { hash } = req.params;
    if (!isHash(hash)) {
      return reply.code(400).send({ error: 'hash must be 64 lowercase hex chars' });
    }
    const parsed = validatePatchBody(req.body);
    if (typeof parsed === 'string') {
      return reply.code(400).send({ error: parsed });
    }
    const updated = store.patch(hash, parsed);
    if (!updated) return reply.code(404).send({ error: 'swap not found' });
    return reply.send(updated);
  });
};
