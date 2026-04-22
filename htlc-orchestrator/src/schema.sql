CREATE TABLE IF NOT EXISTS swaps (
  hash                  TEXT PRIMARY KEY,

  -- Alice's offer (set on POST /swaps)
  alice_cpk             TEXT NOT NULL,
  alice_unshielded      TEXT NOT NULL,
  ada_amount            TEXT NOT NULL,
  usdc_amount           TEXT NOT NULL,
  cardano_deadline_ms   INTEGER NOT NULL,
  cardano_lock_tx       TEXT NOT NULL,

  -- Bob's acceptance (set when Bob deposits)
  bob_cpk               TEXT,
  bob_unshielded        TEXT,
  bob_pkh               TEXT,
  midnight_deadline_ms  INTEGER,
  midnight_deposit_tx   TEXT,

  -- Claim / reclaim receipts (set by watchers)
  midnight_claim_tx     TEXT,
  cardano_claim_tx      TEXT,
  cardano_reclaim_tx    TEXT,
  midnight_reclaim_tx   TEXT,

  status                TEXT NOT NULL CHECK (status IN (
                          'open',
                          'bob_deposited',
                          'alice_claimed',
                          'completed',
                          'alice_reclaimed',
                          'bob_reclaimed',
                          'expired'
                        )),

  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_swaps_status     ON swaps(status);
CREATE INDEX IF NOT EXISTS idx_swaps_alice_cpk  ON swaps(alice_cpk);
CREATE INDEX IF NOT EXISTS idx_swaps_bob_cpk    ON swaps(bob_cpk);
