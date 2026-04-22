/**
 * /mint-usdc — self-serve USDC minting page.
 *
 * The USDC contract has NO auth on mint — anyone with tNight for fees can
 * mint to any recipient. In the CLI flow this is handled by
 * `htlc-ft-cli/src/mint-usdc.ts`; the browser equivalent just calls
 * `UsdcAPI.mint(userEither(recipientBytes), amount)` via the connected 1AM
 * wallet. Bob needs this before his first swap (otherwise `receiveUnshielded`
 * inside `htlc.deposit` fails with no matching-color coins).
 *
 * Default recipient is the connected wallet's own unshielded address so the
 * common case is "connect Lace, click Mint".
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, Chip, Divider, Stack, TextField, Typography } from '@mui/material';
import { useSwapContext } from '../hooks';
import { useToast } from '../hooks/useToast';
import { AsyncButton } from './AsyncButton';
import { WalletGate } from './WalletGate';
import { hexToBytes, userEither } from '../api/key-encoding';

const MintUsdcInner: React.FC = () => {
  const { session, swapState } = useSwapContext();
  const toast = useToast();
  const [recipient, setRecipient] = useState<string>('');
  const [amount, setAmount] = useState<string>('10');
  const [lastMint, setLastMint] = useState<{ amount: string; recipient: string } | undefined>(undefined);

  useEffect(() => {
    if (session && !recipient) {
      setRecipient(session.bootstrap.unshieldedAddressHex);
    }
  }, [session, recipient]);

  const onMint = useCallback(async () => {
    if (!session) throw new Error('Midnight wallet not connected');
    const clean = recipient.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      throw new Error('Recipient must be a 64-hex unshielded address.');
    }
    const amt = BigInt(amount);
    if (amt <= 0n) throw new Error('Amount must be a positive integer.');
    const recipientBytes = hexToBytes(clean);
    await session.usdcApi.mint(userEither(recipientBytes), amt);
    setLastMint({ amount: amount, recipient: clean });
    toast.success(`Minted ${amount} USDC to ${clean.slice(0, 12)}…`);
  }, [session, recipient, amount, toast]);

  const onMintToSelf = useCallback(() => {
    if (!session) return;
    setRecipient(session.bootstrap.unshieldedAddressHex);
  }, [session]);

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      <Typography variant="h4">Mint USDC</Typography>
      <Alert severity="info">
        <Typography variant="body2">
          The USDC contract has <strong>no auth on mint</strong> — anyone can mint any amount to any recipient. This is
          intentional for the demo so users can self-serve the tokens they need for a swap. In production you would
          restrict minting.
        </Typography>
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6">Parameters</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Typography variant="body2" sx={{ minWidth: 80 }}>
                Token
              </Typography>
              <Chip size="small" label={swapState.tokenSymbol} />
              <Typography variant="caption" sx={{ wordBreak: 'break-all', opacity: 0.7 }}>
                color: {swapState.usdcColor}
              </Typography>
            </Stack>

            <TextField
              label="Recipient (Midnight unshielded address, 64 hex)"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim().toLowerCase())}
              size="small"
              helperText={
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center', cursor: 'pointer' }}
                  onClick={onMintToSelf}
                >
                  Use my connected 1AM wallet address
                </Box>
              }
              fullWidth
            />

            <TextField
              label="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              size="small"
              helperText="Native unshielded tokens — no decimals. 1 USDC = 1 native coin."
            />

            <Divider />

            <AsyncButton variant="contained" color="primary" onClick={onMint}>
              Mint USDC
            </AsyncButton>

            {lastMint && (
              <Alert severity="success">
                Minted {lastMint.amount} USDC to {lastMint.recipient.slice(0, 16)}…
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
};

export const MintUsdc: React.FC = () => (
  <WalletGate require={{ midnight: true }} title="Mint USDC">
    <MintUsdcInner />
  </WalletGate>
);
