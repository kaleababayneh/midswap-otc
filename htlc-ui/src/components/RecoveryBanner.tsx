/**
 * Global recovery banner — renders at the top of every page when the user's
 * connected wallets have reclaimable stuck swaps (deadline passed, funds
 * recoverable).
 *
 * Quiet when there's nothing to do; prominent (warning) when action is needed.
 * One click takes the user straight to /reclaim where the list-driven UI
 * handles it.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSwapContext } from '../hooks';
import { orchestratorClient, type Swap } from '../api/orchestrator-client';

export const RecoveryBanner: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, cardano } = useSwapContext();
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());

  const myCpk = session?.bootstrap.coinPublicKeyHex?.toLowerCase();
  const myPkh = cardano?.paymentKeyHash?.toLowerCase();

  useEffect(() => {
    if (!myCpk && !myPkh) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const { swaps: list } = await orchestratorClient.listSwaps();
        if (!cancelled) setSwaps(list);
      } catch {
        /* orchestrator is optional — ignore unreachable */
      }
    };
    void refresh();
    const id = setInterval(() => void refresh(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [myCpk, myPkh]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const { adaCount, usdcCount } = useMemo(() => {
    let ada = 0;
    let usdc = 0;
    for (const s of swaps) {
      const iAmAlice = myCpk && s.aliceCpk.toLowerCase() === myCpk;
      const iAmBob = myCpk && s.bobCpk?.toLowerCase() === myCpk;
      if (iAmAlice && (s.status === 'open' || s.status === 'bob_deposited') && s.cardanoDeadlineMs < nowMs) {
        ada++;
      }
      if (iAmBob && s.status === 'bob_deposited' && s.midnightDeadlineMs !== null && s.midnightDeadlineMs < nowMs) {
        usdc++;
      }
    }
    return { adaCount: ada, usdcCount: usdc };
  }, [swaps, nowMs, myCpk]);

  const total = adaCount + usdcCount;
  if (total === 0) return null;
  if (location.pathname === '/reclaim') return null;

  const parts: string[] = [];
  if (adaCount > 0) parts.push(`${adaCount} ADA lock${adaCount === 1 ? '' : 's'}`);
  if (usdcCount > 0) parts.push(`${usdcCount} USDC deposit${usdcCount === 1 ? '' : 's'}`);

  return (
    <Alert
      severity="warning"
      icon={<WarningAmberIcon />}
      sx={{ mb: 2 }}
      action={
        <Button size="small" color="warning" variant="contained" onClick={() => navigate('/reclaim')}>
          Go to Reclaim
        </Button>
      }
    >
      You have {parts.join(' and ')} past their deadline — reclaim now to recover funds.
    </Alert>
  );
};
