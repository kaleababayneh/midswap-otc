/**
 * Gate component — wraps a page and shows a wallet-connect card if either
 * wallet is missing. Role pages (Alice, Bob, Reclaim, Mint) use this so they
 * don't have to re-render conditional "connect first" UI inline.
 *
 *   <WalletGate require={{ midnight: true, cardano: true }} title="Alice">
 *     <AliceInner />
 *   </WalletGate>
 *
 * If the user has neither wallet extension installed, surface the well-known
 * download links — they're public URLs (Lace + Eternl browser stores) and it
 * removes the "what do I do now?" dead-end.
 */

import React from 'react';
import { Alert, Box, Link, Stack, Typography } from '@mui/material';
import { useSwapContext } from '../hooks';
import { WalletConnect } from './WalletConnect';

interface Props {
  readonly require: { midnight?: boolean; cardano?: boolean };
  readonly title?: string;
  readonly intro?: React.ReactNode;
  readonly children: React.ReactNode;
}

const hasMidnightExtension = (): boolean => {
  if (typeof window === 'undefined') return true;
  return typeof (window as { midnight?: unknown }).midnight !== 'undefined';
};

const hasCardanoExtension = (): boolean => {
  if (typeof window === 'undefined') return true;
  const cardano = (window as { cardano?: Record<string, unknown> }).cardano;
  return !!cardano && Object.keys(cardano).length > 0;
};

export const WalletGate: React.FC<Props> = ({ require, title, intro, children }) => {
  const { session, cardano } = useSwapContext();
  const needsMidnight = require.midnight && !session;
  const needsCardano = require.cardano && !cardano;
  const ready = !needsMidnight && !needsCardano;

  if (ready) return <>{children}</>;

  const missingExt = {
    midnight: needsMidnight && !hasMidnightExtension(),
    cardano: needsCardano && !hasCardanoExtension(),
  };

  return (
    <Stack spacing={3} sx={{ width: '100%', maxWidth: 720 }}>
      {title && <Typography variant="h4">{title}</Typography>}
      {intro}
      <Alert severity="info">
        This page needs {needsMidnight && 'Lace (Midnight)'}
        {needsMidnight && needsCardano && ' and '}
        {needsCardano && 'a Cardano CIP-30 wallet (Eternl recommended)'} connected to continue.
      </Alert>

      {(missingExt.midnight || missingExt.cardano) && (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ mb: 1 }}>
            Some wallet extensions aren&apos;t installed:
          </Typography>
          <Stack spacing={0.5}>
            {missingExt.midnight && (
              <Box>
                Midnight:{' '}
                <Link
                  href="https://docs.midnight.network/develop/tutorial/building/prereqs"
                  target="_blank"
                  rel="noopener"
                >
                  Install Lace (Midnight) →
                </Link>
              </Box>
            )}
            {missingExt.cardano && (
              <Box>
                Cardano:{' '}
                <Link href="https://eternl.io" target="_blank" rel="noopener">
                  Install Eternl →
                </Link>
              </Box>
            )}
          </Stack>
        </Alert>
      )}

      <WalletConnect />
    </Stack>
  );
};
