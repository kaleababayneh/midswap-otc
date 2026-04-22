/**
 * App-wide toast/snackbar — single place to surface wallet errors, network
 * blips, orchestrator 500s, "copied to clipboard", success confirmations.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.error('Wallet rejected the transaction');
 *   toast.success('Share URL copied');
 *   toast.info('Waiting for Bob…');
 *
 * Under the hood: a single MUI <Snackbar> rendered at the layout root, fed by
 * a queue. Only one toast visible at a time; subsequent calls queue behind.
 */

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Alert, Snackbar, type AlertColor } from '@mui/material';

interface ToastMessage {
  key: number;
  severity: AlertColor;
  message: string;
  duration: number;
}

interface ToastContextValue {
  show: (severity: AlertColor, message: string, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
  warning: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const DEFAULT_DURATION: Record<AlertColor, number> = {
  success: 3500,
  info: 3500,
  warning: 6000,
  error: 8000,
};

export const ToastProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [, setQueue] = useState<ToastMessage[]>([]);
  const [current, setCurrent] = useState<ToastMessage | undefined>(undefined);
  const keyRef = useRef(0);

  const pushNext = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) {
        setCurrent(undefined);
        return q;
      }
      const [head, ...rest] = q;
      setCurrent(head);
      return rest;
    });
  }, []);

  const show = useCallback((severity: AlertColor, message: string, durationMs?: number): void => {
    const msg: ToastMessage = {
      key: ++keyRef.current,
      severity,
      message,
      duration: durationMs ?? DEFAULT_DURATION[severity],
    };
    setCurrent((prev) => {
      if (prev) {
        setQueue((q) => [...q, msg]);
        return prev;
      }
      return msg;
    });
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (m, d) => show('success', m, d),
      info: (m, d) => show('info', m, d),
      warning: (m, d) => show('warning', m, d),
      error: (m, d) => show('error', m, d),
    }),
    [show],
  );

  const onClose = useCallback((_e: unknown, reason?: string) => {
    if (reason === 'clickaway') return;
    setCurrent(undefined);
  }, []);

  const onExited = useCallback(() => {
    pushNext();
  }, [pushNext]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Snackbar
        key={current?.key}
        open={!!current}
        autoHideDuration={current?.duration}
        onClose={onClose}
        TransitionProps={{ onExited }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {current ? (
          <Alert
            onClose={() => setCurrent(undefined)}
            severity={current.severity}
            variant="filled"
            sx={{ width: '100%', maxWidth: 600 }}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};
