import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WalletConnect } from './WalletConnect';
import { useSwapContext } from '../hooks';
import type { HTLCDerivedState } from '../api/common-types';

export const Landing: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, swapState } = useSwapContext();
  const [htlcState, setHtlcState] = useState<HTLCDerivedState | undefined>(undefined);
  const [stateError, setStateError] = useState<string | undefined>(undefined);

  // Auto-redirect if URL says "?role=bob" (Alice sent Bob a share link).
  useEffect(() => {
    const role = searchParams.get('role');
    if (role === 'bob') {
      navigate(`/bob?${searchParams.toString()}`, { replace: true });
    } else if (role === 'alice') {
      navigate('/alice', { replace: true });
    }
  }, [searchParams, navigate]);

  useEffect(() => {
    if (!session) return;
    const sub = session.htlcApi.state$.subscribe({
      next: setHtlcState,
      error: (e) => setStateError(e instanceof Error ? e.message : String(e)),
    });
    return () => sub.unsubscribe();
  }, [session]);

  return (
    <Stack spacing={3} alignItems="center" sx={{ width: '100%' }}>
      <Typography variant="h3" sx={{ textAlign: 'center' }}>
        Midnight ⇄ Cardano Atomic Swap
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 720, textAlign: 'center' }}>
        Swap ADA on Cardano for native USDC on Midnight — trustless, hash-time-locked, no custodian. Connect both
        wallets and pick your role, or read{' '}
        <Button component="span" variant="text" size="small" onClick={() => navigate('/how-to')}>
          how it works
        </Button>{' '}
        first.
      </Typography>

      <WalletConnect />

      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap justifyContent="center">
        <Button variant="contained" size="large" disabled={!session} onClick={() => navigate('/alice')}>
          I am Alice (have ADA, want USDC)
        </Button>
        <Button variant="contained" size="large" color="secondary" onClick={() => navigate('/browse')}>
          Browse open offers
        </Button>
        <Button variant="outlined" size="large" disabled={!session} onClick={() => navigate('/mint-usdc')}>
          Mint USDC
        </Button>
        <Button variant="outlined" size="large" disabled={!session} onClick={() => navigate('/reclaim')}>
          Reclaim
        </Button>
      </Stack>

      {session && (
        <Card sx={{ width: '100%', maxWidth: 720 }}>
          <CardContent>
            <Typography variant="h6">Deployed contracts ({swapState.network})</Typography>
            <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-all' }}>
              HTLC: {swapState.htlcContractAddress}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-all' }}>
              USDC: {swapState.usdcContractAddress}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', wordBreak: 'break-all' }}>
              USDC color: {swapState.usdcColor}
            </Typography>
            {htlcState && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2">HTLC rows: {htlcState.entries.size}</Typography>
              </Box>
            )}
            {stateError && <Alert severity="error">{stateError}</Alert>}
          </CardContent>
        </Card>
      )}
    </Stack>
  );
};
