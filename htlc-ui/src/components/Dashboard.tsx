/**
 * /dashboard — read-only visibility into every swap the orchestrator knows
 * about. Groups by status and surfaces aggregate counts so ops can tell at a
 * glance whether the system is healthy or has stuck swaps.
 *
 * The orchestrator is advisory, not authoritative — the UI is clear that the
 * chains are the source of truth.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { orchestratorClient, type Swap, type SwapStatus } from '../api/orchestrator-client';
import { statusLabel, SwapStatusChip } from './SwapStatusChip';

interface Aggregate {
  total: number;
  byStatus: Record<SwapStatus, number>;
  totalAda: bigint;
  totalUsdc: bigint;
  stuck: number;
}

const ZERO_BY_STATUS: Record<SwapStatus, number> = {
  open: 0,
  bob_deposited: 0,
  alice_claimed: 0,
  completed: 0,
  alice_reclaimed: 0,
  bob_reclaimed: 0,
  expired: 0,
};

const formatAge = (ms: number): string => {
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const shortHash = (hash: string): string => `${hash.slice(0, 10)}…${hash.slice(-4)}`;

const TX_SCAN_BASE: Record<string, string> = {
  midnight: 'https://indexer.preprod.midnight.network/tx/',
  cardano: 'https://preprod.cardanoscan.io/transaction/',
};

export const Dashboard: React.FC = () => {
  const [swaps, setSwaps] = useState<Swap[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const refresh = useCallback(async () => {
    setError(undefined);
    setLoading(true);
    try {
      const { swaps: list } = await orchestratorClient.listSwaps();
      setSwaps(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const aggregate = useMemo<Aggregate | undefined>(() => {
    if (!swaps) return undefined;
    const byStatus: Record<SwapStatus, number> = { ...ZERO_BY_STATUS };
    let totalAda = 0n;
    let totalUsdc = 0n;
    let stuck = 0;
    for (const s of swaps) {
      byStatus[s.status]++;
      try {
        totalAda += BigInt(s.adaAmount);
        totalUsdc += BigInt(s.usdcAmount);
      } catch {
        /* ignore malformed decimals */
      }
      const cardanoExpired = s.cardanoDeadlineMs < nowMs;
      const midnightExpired = s.midnightDeadlineMs !== null && s.midnightDeadlineMs < nowMs;
      const isStuck =
        (s.status === 'open' && cardanoExpired) ||
        (s.status === 'bob_deposited' && (cardanoExpired || midnightExpired)) ||
        (s.status === 'alice_claimed' && cardanoExpired);
      if (isStuck) stuck++;
    }
    return { total: swaps.length, byStatus, totalAda, totalUsdc, stuck };
  }, [swaps, nowMs]);

  const txLink = (chain: 'midnight' | 'cardano', hash: string | null): React.ReactNode => {
    if (!hash) return <Typography variant="caption">—</Typography>;
    return (
      <a href={`${TX_SCAN_BASE[chain]}${hash}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
        <code>{shortHash(hash)}</code>
      </a>
    );
  };

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 1280 }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h4" sx={{ flex: 1 }}>
          Swap dashboard
        </Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => void refresh()} disabled={loading}>
          Refresh
        </Button>
      </Stack>

      <Alert severity="info">
        Aggregated from the orchestrator DB. Chain state is authoritative — this page is a convenience view.
      </Alert>

      {error && (
        <Alert severity="error">
          Orchestrator unreachable: {error}
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption">
              <code>cd htlc-orchestrator &amp;&amp; npm run dev</code>
            </Typography>
          </Box>
        </Alert>
      )}

      {loading && !swaps && (
        <Stack direction="row" spacing={2} alignItems="center">
          <CircularProgress size={20} />
          <Typography>Loading swaps…</Typography>
        </Stack>
      )}

      {aggregate && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Total tracked
              </Typography>
              <Typography variant="h3">{aggregate.total}</Typography>
              <Typography variant="caption" color="text.secondary">
                {aggregate.totalAda.toString()} ADA · {aggregate.totalUsdc.toString()} USDC
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Completed
              </Typography>
              <Typography variant="h3" color="success.main">
                {aggregate.byStatus.completed}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {aggregate.total > 0
                  ? `${Math.round((aggregate.byStatus.completed / aggregate.total) * 100)}% success rate`
                  : 'no swaps yet'}
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                In flight
              </Typography>
              <Typography variant="h3" color="info.main">
                {aggregate.byStatus.open + aggregate.byStatus.bob_deposited + aggregate.byStatus.alice_claimed}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                open · deposited · claimed
              </Typography>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                Stuck / expired
              </Typography>
              <Typography variant="h3" color={aggregate.stuck > 0 ? 'warning.main' : 'text.primary'}>
                {aggregate.stuck}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                deadline passed, reclaim pending
              </Typography>
            </CardContent>
          </Card>
        </Stack>
      )}

      {aggregate && (
        <Card>
          <CardContent>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {(Object.keys(aggregate.byStatus) as SwapStatus[]).map((s) => (
                <Chip
                  key={s}
                  label={`${statusLabel(s)}: ${aggregate.byStatus[s]}`}
                  variant={aggregate.byStatus[s] > 0 ? 'filled' : 'outlined'}
                  size="small"
                />
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      {swaps && swaps.length > 0 && (
        <Card>
          <CardContent sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hash</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>ADA</TableCell>
                  <TableCell>USDC</TableCell>
                  <TableCell>Age</TableCell>
                  <TableCell>Cardano deadline</TableCell>
                  <TableCell>Cardano lock</TableCell>
                  <TableCell>Cardano claim</TableCell>
                  <TableCell>Midnight deposit</TableCell>
                  <TableCell>Midnight claim</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {swaps.map((s) => (
                  <TableRow key={s.hash} hover>
                    <TableCell>
                      <code>{shortHash(s.hash)}</code>
                    </TableCell>
                    <TableCell>
                      <SwapStatusChip status={s.status} />
                    </TableCell>
                    <TableCell>{s.adaAmount}</TableCell>
                    <TableCell>{s.usdcAmount}</TableCell>
                    <TableCell>{formatAge(s.createdAt)}</TableCell>
                    <TableCell>
                      <Typography variant="caption">
                        {new Date(s.cardanoDeadlineMs).toISOString().slice(0, 19)}
                      </Typography>
                    </TableCell>
                    <TableCell>{txLink('cardano', s.cardanoLockTx)}</TableCell>
                    <TableCell>{txLink('cardano', s.cardanoClaimTx ?? s.cardanoReclaimTx)}</TableCell>
                    <TableCell>{txLink('midnight', s.midnightDepositTx)}</TableCell>
                    <TableCell>{txLink('midnight', s.midnightClaimTx ?? s.midnightReclaimTx)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {swaps && swaps.length === 0 && (
        <Card>
          <CardContent>
            <Typography>No swaps yet. Start one on the Alice page.</Typography>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
};
