-- First-party measurement (#23). Allowlisted fields only: no email, free text, code,
-- transcript, URL, referrer, IP address, cookie or account identifier.
CREATE TABLE IF NOT EXISTS measurement_events (
  id text PRIMARY KEY,
  name text NOT NULL,
  surface text NOT NULL,
  activity text NOT NULL CHECK (activity IN ('none', 'sample', 'personal')),
  action text NOT NULL,
  authority text NOT NULL CHECK (authority IN ('client', 'server')),
  -- Random per page load; links events of one document, never a person.
  exposure_id text,
  zone text,
  -- heatGridSize (20) of public/measurement-contract.js.
  cell_x smallint CHECK (cell_x BETWEEN 0 AND 19),
  cell_y smallint CHECK (cell_y BETWEEN 0 AND 19),
  viewport text CHECK (viewport IN ('narrow', 'wide')),
  duplicate_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS measurement_events_received_idx ON measurement_events (received_at);
