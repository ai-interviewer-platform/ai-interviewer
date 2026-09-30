CREATE TABLE IF NOT EXISTS waitlist_entries (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  receipt_hash text NOT NULL UNIQUE,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No email, receipt or visitor identifier enters measurement outcomes.
CREATE TABLE IF NOT EXISTS waitlist_outcomes (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (name IN ('waitlist_joined', 'waitlist_withdrawn')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  policy_version text NOT NULL
);
