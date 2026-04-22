/**
 * Alice's "send this URL to Bob" card.
 *
 *   • Prominent copy button (toast confirmation on success)
 *   • QR code — Bob scans from phone → instantly in the /bob flow
 *   • Truncated preview so the URL doesn't eat the page
 *   • Native `navigator.share` on mobile if available
 */

import React, { useCallback, useState } from 'react';
import { Box, Button, Card, CardContent, IconButton, Link, Stack, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import IosShareIcon from '@mui/icons-material/IosShare';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { QRCodeSVG } from 'qrcode.react';
import { useToast } from '../hooks/useToast';

interface Props {
  readonly shareUrl: string;
  readonly title?: string;
}

const hasNativeShare = (): boolean =>
  typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: unknown }).share === 'function';

export const ShareUrlCard: React.FC<Props> = ({ shareUrl, title = 'Send this URL to Bob' }) => {
  const toast = useToast();
  const [showFull, setShowFull] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Share URL copied to clipboard');
    } catch (e) {
      toast.error(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [shareUrl, toast]);

  const onNativeShare = useCallback(async () => {
    try {
      await (navigator as Navigator & { share: (d: { url: string; title?: string }) => Promise<void> }).share({
        url: shareUrl,
        title: 'HTLC Atomic Swap — take this offer',
      });
    } catch (e) {
      const err = e as DOMException;
      if (err.name === 'AbortError') return;
      toast.warning(`Share failed: ${err.message}`);
    }
  }, [shareUrl, toast]);

  const preview = shareUrl.length > 72 ? `${shareUrl.slice(0, 56)}…${shareUrl.slice(-8)}` : shareUrl;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{title}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
            <Box
              sx={{
                p: 1.5,
                bgcolor: '#fff',
                borderRadius: 1,
                alignSelf: { xs: 'center', sm: 'flex-start' },
              }}
            >
              <QRCodeSVG value={shareUrl} size={168} level="M" />
            </Box>
            <Stack spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary">
                Bob scans this QR or clicks the URL on any device that has Lace + Eternl to take the offer.
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  fontFamily: 'monospace',
                  fontSize: 13,
                  p: 1,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  wordBreak: 'break-all',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>{showFull ? shareUrl : preview}</Box>
                <Tooltip title={showFull ? 'Collapse' : 'Show full URL'}>
                  <IconButton size="small" onClick={() => setShowFull((v) => !v)}>
                    <OpenInNewIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button startIcon={<ContentCopyIcon />} variant="contained" onClick={onCopy} size="small">
                  Copy URL
                </Button>
                {hasNativeShare() && (
                  <Button startIcon={<IosShareIcon />} variant="outlined" onClick={onNativeShare} size="small">
                    Share…
                  </Button>
                )}
                <Button component={Link} href={shareUrl} target="_blank" rel="noopener" variant="text" size="small">
                  Open in new tab
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};
