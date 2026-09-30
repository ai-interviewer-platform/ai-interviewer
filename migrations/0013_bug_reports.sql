-- Bug reports (#22). No account, attempt, code, transcript, audio or log: the reporter's
-- description, allowlisted diagnostics, an optional reply address and private triage fields.
CREATE TABLE IF NOT EXISTS bug_reports (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  surface text NOT NULL,
  feature text NOT NULL,
  activity text NOT NULL CHECK (activity IN ('none', 'sample', 'personal')),
  expected text NOT NULL,
  actual text NOT NULL,
  steps text,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_email text,
  contact_purpose text,
  -- bugStatuses and closedBugStatuses of public/bug-report-contract.js.
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'fixed', 'cannot_reproduce', 'declined')),
  investigation text,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((contact_email IS NULL) = (contact_purpose IS NULL)),
  CHECK (status NOT IN ('fixed', 'cannot_reproduce', 'declined') OR (resolution IS NOT NULL AND contact_email IS NULL))
);
CREATE INDEX IF NOT EXISTS bug_reports_triage_idx ON bug_reports (status, created_at DESC);

-- Triage changes status, investigation and resolution. The reply address can only be erased.
CREATE OR REPLACE FUNCTION preserve_bug_report() RETURNS trigger AS $$
BEGIN
  IF (NEW.id, NEW.reference, NEW.surface, NEW.feature, NEW.activity, NEW.expected, NEW.actual, NEW.steps, NEW.diagnostics, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.reference, OLD.surface, OLD.feature, OLD.activity, OLD.expected, OLD.actual, OLD.steps, OLD.diagnostics, OLD.created_at)
    OR (NEW.contact_email IS NOT NULL AND NEW.contact_email IS DISTINCT FROM OLD.contact_email)
    OR (NEW.contact_purpose IS NOT NULL AND NEW.contact_purpose IS DISTINCT FROM OLD.contact_purpose) THEN
    RAISE EXCEPTION 'original bug report is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS bug_reports_preserved ON bug_reports;
CREATE TRIGGER bug_reports_preserved BEFORE UPDATE ON bug_reports FOR EACH ROW EXECUTE FUNCTION preserve_bug_report();
