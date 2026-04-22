/**
 * Unified status chip for orchestrator swap statuses.
 * One vocabulary, one palette — rendered consistently in Browse, Reclaim,
 * Dashboard, and the recovery banner.
 */

import React from 'react';
import { Chip, type ChipProps } from '@mui/material';
import type { SwapStatus } from '../api/orchestrator-client';

type ChipColor = NonNullable<ChipProps['color']>;

interface StatusMeta {
  label: string;
  color: ChipColor;
  description: string;
}

const META: Record<SwapStatus, StatusMeta> = {
  open: { label: 'Open', color: 'info', description: 'Waiting for Bob to deposit' },
  bob_deposited: { label: 'Bob deposited', color: 'primary', description: 'Waiting for Alice to claim' },
  alice_claimed: {
    label: 'Alice claimed',
    color: 'primary',
    description: 'Preimage revealed — waiting for Bob to claim ADA',
  },
  completed: { label: 'Completed', color: 'success', description: 'Swap finished' },
  alice_reclaimed: { label: 'Alice reclaimed', color: 'warning', description: 'Alice refunded her ADA' },
  bob_reclaimed: { label: 'Bob reclaimed', color: 'warning', description: 'Bob refunded his USDC' },
  expired: { label: 'Expired', color: 'error', description: 'Past deadline — needs manual reclaim' },
};

export const statusLabel = (s: SwapStatus): string => META[s].label;
export const statusDescription = (s: SwapStatus): string => META[s].description;

interface Props {
  status: SwapStatus;
  size?: ChipProps['size'];
  variant?: ChipProps['variant'];
}

export const SwapStatusChip: React.FC<Props> = ({ status, size = 'small', variant = 'filled' }) => {
  const meta = META[status];
  return <Chip size={size} variant={variant} color={meta.color} label={meta.label} title={meta.description} />;
};
