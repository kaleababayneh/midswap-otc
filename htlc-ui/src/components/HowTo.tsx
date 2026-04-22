/**
 * /how-to — onboarding + conceptual walkthrough.
 *
 * Meant for a first-time user who just landed here. Answers:
 *   1. What is this?
 *   2. What wallets do I need?
 *   3. What's the flow for Alice vs. Bob?
 *   4. Where does the trust come from?
 *   5. What happens if something breaks?
 *
 * Keep it prose-heavy and dependency-light — don't import the swap context,
 * this page must render even when the whole stack is down.
 */

import React from 'react';
import { Alert, Box, Card, CardContent, Chip, Divider, Link, List, ListItem, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <Stack direction="row" spacing={2} alignItems="flex-start">
    <Chip label={n} color="primary" sx={{ fontWeight: 600, minWidth: 36 }} />
    <Box sx={{ flex: 1 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Box>
  </Stack>
);

export const HowTo: React.FC = () => (
  <Stack spacing={3} sx={{ width: '100%', maxWidth: 860 }}>
    <Typography variant="h3">How the atomic swap works</Typography>
    <Typography variant="body1" color="text.secondary">
      Trade ADA on Cardano ↔ native USDC on Midnight, without trusting a counterparty or a custodian. Escrow is
      hash-time-locked on both chains; if either side times out the funds reclaim back to the original sender.
    </Typography>

    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">1. What you&apos;ll need</Typography>
          <List dense disablePadding>
            <ListItem>
              <Typography variant="body2">
                <strong>Midnight wallet:</strong>{' '}
                <Link
                  href="https://docs.midnight.network/develop/tutorial/building/prereqs"
                  target="_blank"
                  rel="noopener"
                >
                  Install Lace (Midnight)
                </Link>{' '}
                + some tNight for fees (get from the{' '}
                <Link href="https://faucet.preprod.midnight.network/" target="_blank" rel="noopener">
                  preprod faucet
                </Link>
                ). Dust sync can take ~15 minutes — start early.
              </Typography>
            </ListItem>
            <ListItem>
              <Typography variant="body2">
                <strong>Cardano wallet:</strong>{' '}
                <Link href="https://eternl.io" target="_blank" rel="noopener">
                  Install Eternl
                </Link>{' '}
                configured for the <em>Preprod</em> network, plus ADA from the{' '}
                <Link href="https://docs.cardano.org/cardano-testnets/tools/faucet" target="_blank" rel="noopener">
                  Cardano preprod faucet
                </Link>
                .
              </Typography>
            </ListItem>
            <ListItem>
              <Typography variant="body2">
                <strong>For Bob only:</strong> native USDC in your 1AM wallet before starting. Mint some on the{' '}
                <RouterLink to="/mint-usdc">/mint-usdc</RouterLink> page — it only takes one signature.
              </Typography>
            </ListItem>
          </List>
        </Stack>
      </CardContent>
    </Card>

    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">2. Alice&apos;s side — lock ADA, claim USDC</Typography>
          <Step n={1} title="Generate a secret preimage">
            Alice&apos;s browser generates a random 32-byte preimage and computes its SHA-256 hash. Only the hash is
            ever shared with anyone — the preimage stays in her browser.
          </Step>
          <Step n={2} title="Lock ADA on Cardano">
            One Eternl signature posts an HTLC UTxO to the Cardano validator. The UTxO is bound to Bob&apos;s Cardano
            PKH and the hash; only Bob can claim, and only with a matching preimage.
          </Step>
          <Step n={3} title="Share the offer">
            Alice sends Bob a share URL (or QR code) with the hash + her Midnight keys + the deadline. The offer also
            appears on <RouterLink to="/browse">/browse</RouterLink> so any Bob with the right wallet can find it.
          </Step>
          <Step n={4} title="Wait for Bob's deposit">
            The page watches Midnight for a matching USDC deposit. As soon as Bob&apos;s transaction finalizes, the
            &quot;Claim USDC&quot; button unlocks.
          </Step>
          <Step n={5} title="Claim USDC (reveals the preimage)">
            One 1AM signature calls <code>withdrawWithPreimage</code>. The circuit records the preimage in the
            HTLC&apos;s <code>revealedPreimages</code> map — public, but harmless: it can only unlock the swap
            they&apos;re already party to.
          </Step>
        </Stack>
      </CardContent>
    </Card>

    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">3. Bob&apos;s side — deposit USDC, claim ADA</Typography>
          <Step n={1} title="Open Alice's offer">
            Either click her share URL or pick the offer from <RouterLink to="/browse">/browse</RouterLink>. The page
            auto-fills the hash, her keys, and the deadline.
          </Step>
          <Step n={2} title="Verify the Cardano lock">
            The page watches Cardano for Alice&apos;s HTLC UTxO, filtered by hash + his PKH. If the deadline is too
            close or already gone, the page aborts and tells him why.
          </Step>
          <Step n={3} title="Deposit USDC on Midnight">
            One 1AM signature calls <code>htlc.deposit</code> with a deadline strictly inside Alice&apos;s. His USDC is
            now escrowed.
          </Step>
          <Step n={4} title="Wait for the preimage">
            The page watches Midnight for Alice&apos;s reveal. Usually fast — a few seconds to a minute.
          </Step>
          <Step n={5} title="Claim ADA on Cardano">
            With the preimage now public, one Eternl signature spends Alice&apos;s HTLC UTxO. Swap complete.
          </Step>
        </Stack>
      </CardContent>
    </Card>

    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">4. What about failures?</Typography>
          <Typography variant="body2">
            Neither side can steal funds — the worst case is time-out, and funds reclaim to the original sender. If Bob
            never deposits, Alice&apos;s ADA is refundable after her Cardano deadline. If Alice never reveals,
            Bob&apos;s USDC is refundable after his Midnight deadline (which is always strictly earlier).
          </Typography>
          <Alert severity="info">
            Visit <RouterLink to="/reclaim">/reclaim</RouterLink> any time — the page lists reclaimable swaps for your
            connected wallet and submits the recovery transaction with one click.
          </Alert>
        </Stack>
      </CardContent>
    </Card>

    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h5">5. Where does the trust come from?</Typography>
          <Typography variant="body2">
            Nowhere — that&apos;s the point. The SHA-256 hash is the atomic link: revealing the preimage to claim USDC
            on Midnight publishes it on-chain, and Bob&apos;s Cardano claim requires the same preimage. The two
            deadlines are staggered (Alice&apos;s always ≥ 5 minutes longer than Bob&apos;s) so if the preimage goes
            stale the loser is whoever didn&apos;t act in time — not whoever got defrauded.
          </Typography>
          <Divider />
          <Typography variant="body2">
            The <RouterLink to="/dashboard">/dashboard</RouterLink> page shows the live state of every swap tracked by
            the orchestrator — open offers, in-flight swaps, completed ones. It&apos;s purely informational: chain state
            is always authoritative.
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  </Stack>
);
