-- Additive migration: safe for databases where 0001_init.sql has already run.
ALTER TABLE ideas ADD COLUMN signal_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ideas ADD COLUMN search_text TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS ideas_public_order;
CREATE INDEX IF NOT EXISTS ideas_public_order ON ideas(status, signal_count DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS submission_rate_limits (
  submitter_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 5),
  PRIMARY KEY (submitter_hash, window_start)
);

CREATE INDEX IF NOT EXISTS submission_rate_limits_window ON submission_rate_limits(window_start);

-- Existing seed ideas should be searchable and start with one catalogue signal.
UPDATE ideas SET signal_count = 1 WHERE id LIKE 'seed-%' AND signal_count = 0;
UPDATE ideas
SET search_text = lower(title || ' ' || summary || ' ' || category || ' ' || tags);
