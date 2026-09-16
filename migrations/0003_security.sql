CREATE TABLE security_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX security_rate_limits_expiry ON security_rate_limits (expires_at);

CREATE TABLE voice_reservations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  attempt_id text NOT NULL REFERENCES attempts(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reserved_seconds integer NOT NULL
);
CREATE INDEX voice_reservations_date ON voice_reservations (started_at);
CREATE INDEX voice_reservations_user ON voice_reservations (user_id, expires_at);
ALTER TABLE reviews ADD COLUMN dispatch_claimed_at timestamptz;
