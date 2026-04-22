/**
 * App header with text-only brand, top-level nav, and wallet-balance chips.
 *
 * ADA balance is polled from the connected Eternl wallet (Lucid handles it
 * via `wallet().getUtxos`). Midnight / USDC balances are not exposed in the
 * current SwapContext — we show connection status and a link to /mint-usdc
 * instead, which is the concrete action a user with zero balance needs.
 */

import React, { useEffect, useState } from 'react';
import { AppBar, Box, Button, Chip, Stack, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useSwapContext } from '../../hooks';

const NAV: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Home' },
  { to: '/browse', label: 'Browse' },
  { to: '/alice', label: 'Alice' },
  { to: '/mint-usdc', label: 'Mint USDC' },
  { to: '/reclaim', label: 'Reclaim' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/how-to', label: 'How it works' },
];

const formatAda = (lovelace: bigint): string => {
  const whole = lovelace / 1_000_000n;
  const frac = (lovelace % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
};

export const Header: React.FC = () => {
  const location = useLocation();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const { session, cardano } = useSwapContext();
  const [adaBalance, setAdaBalance] = useState<bigint | undefined>(undefined);

  useEffect(() => {
    if (!cardano) {
      setAdaBalance(undefined);
      return;
    }
    let cancelled = false;
    const update = async (): Promise<void> => {
      try {
        const bal = await cardano.cardanoHtlc.getBalance();
        if (!cancelled) setAdaBalance(bal);
      } catch {
        /* ignore transient balance read errors */
      }
    };
    void update();
    const id = setInterval(() => void update(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [cardano]);

  return (
    <AppBar position="static" elevation={0} color="default" sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Toolbar sx={{ gap: 2 }}>
        <Typography
          variant="h6"
          component={RouterLink}
          to="/"
          sx={{
            textDecoration: 'none',
            color: 'inherit',
            fontWeight: 700,
            letterSpacing: 0.5,
            mr: 2,
          }}
        >
          HTLC Swap
        </Typography>

        {!compact && (
          <Stack direction="row" spacing={0.5} sx={{ flexGrow: 1 }}>
            {NAV.map(({ to, label }) => {
              const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
              return (
                <Button
                  key={to}
                  component={RouterLink}
                  to={to}
                  size="small"
                  variant={active ? 'contained' : 'text'}
                  color={active ? 'primary' : 'inherit'}
                >
                  {label}
                </Button>
              );
            })}
          </Stack>
        )}
        {compact && <Box sx={{ flexGrow: 1 }} />}

        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            icon={<AccountBalanceWalletIcon />}
            size="small"
            label={session ? '1AM' : 'Lace ·'}
            color={session ? 'success' : 'default'}
            variant={session ? 'filled' : 'outlined'}
          />
          <Chip
            icon={<AccountBalanceWalletIcon />}
            size="small"
            label={cardano ? (adaBalance !== undefined ? `${formatAda(adaBalance)} ADA` : 'Eternl') : 'Eternl ·'}
            color={cardano ? 'success' : 'default'}
            variant={cardano ? 'filled' : 'outlined'}
          />
        </Stack>
      </Toolbar>
      {compact && (
        <Stack direction="row" spacing={0.5} sx={{ px: 1, pb: 1, overflowX: 'auto' }}>
          {NAV.map(({ to, label }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <Button
                key={to}
                component={RouterLink}
                to={to}
                size="small"
                variant={active ? 'contained' : 'text'}
                color={active ? 'primary' : 'inherit'}
                sx={{ flexShrink: 0 }}
              >
                {label}
              </Button>
            );
          })}
        </Stack>
      )}
    </AppBar>
  );
};
