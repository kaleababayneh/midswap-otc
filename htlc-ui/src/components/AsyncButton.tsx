/**
 * Async-aware submit button.
 *
 *   - disables + shows a spinner while the onClick promise is pending
 *   - resets itself on failure (so the user can try again)
 *   - after `walletPopupHintMs` surfaces "Check your wallet" so the user knows
 *     the popup is waiting for them (easy to miss behind another tab)
 *
 * Designed for wallet-signing actions that take several seconds to return.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Typography, type ButtonProps } from '@mui/material';
import { limits } from '../config/limits';

interface Props extends Omit<ButtonProps, 'onClick'> {
  onClick: () => Promise<unknown> | void;
  /** Label shown during the pending state. Defaults to "Working…". */
  pendingLabel?: string;
  /** Label for the wallet-popup hint that appears after walletPopupHintMs. */
  walletHint?: string;
}

export const AsyncButton: React.FC<Props> = ({
  onClick,
  pendingLabel = 'Working…',
  walletHint = 'Check your wallet — a signing popup may be waiting.',
  children,
  disabled,
  ...rest
}) => {
  const [pending, setPending] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handle = useCallback(async () => {
    setPending(true);
    setShowHint(false);
    const hintTimer = setTimeout(() => {
      if (mounted.current) setShowHint(true);
    }, limits.walletPopupHintMs);
    try {
      await onClick();
    } finally {
      clearTimeout(hintTimer);
      if (mounted.current) {
        setPending(false);
        setShowHint(false);
      }
    }
  }, [onClick]);

  return (
    <Box>
      <Button
        {...rest}
        disabled={disabled || pending}
        onClick={() => void handle()}
        startIcon={pending ? <CircularProgress size={16} color="inherit" /> : rest.startIcon}
      >
        {pending ? pendingLabel : children}
      </Button>
      {showHint && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.75 }}>
          {walletHint}
        </Typography>
      )}
    </Box>
  );
};
