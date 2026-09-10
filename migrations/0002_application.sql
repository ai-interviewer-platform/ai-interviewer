-- Apply Better Auth's generated PostgreSQL schema before this migration.
-- Application IDs are generated in the Worker so they remain compatible with
-- Better Auth's text user IDs without requiring a database UUID extension.

CREATE TABLE problems (
  id text PRIMARY KEY,
  problem_family_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  title text NOT NULL,
  topic text NOT NULL,
  difficulty text NOT NULL,
  prompt text NOT NULL,
  starter_code text NOT NULL,
  reference_solution text NOT NULL,
  clarification_guidance text NOT NULL,
  help_guidance text NOT NULL,
  entry_point text NOT NULL,
  test_contract jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_sample boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (problem_family_id, revision)
);

CREATE TABLE test_cases (
  id text PRIMARY KEY,
  problem_id text NOT NULL REFERENCES problems(id),
  input_data jsonb NOT NULL,
  expected_output jsonb NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('visible', 'hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE related_problems (
  id text PRIMARY KEY,
  source_problem_id text NOT NULL REFERENCES problems(id),
  related_problem_id text NOT NULL REFERENCES problems(id),
  relationship_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_problem_id, related_problem_id),
  CHECK (source_problem_id <> related_problem_id)
);

CREATE TABLE attempts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  problem_id text NOT NULL REFERENCES problems(id),
  mode text NOT NULL CHECK (mode IN ('mock', 'coach')),
  input_mode text NOT NULL CHECK (input_mode IN ('text', 'voice')),
  status text NOT NULL CHECK (status IN ('setup', 'active', 'interrupted', 'completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  source_attempt_id text REFERENCES attempts(id),
  source_checkpoint_id text,
  save_audio boolean NOT NULL DEFAULT false,
  draft_source text NOT NULL DEFAULT '',
  draft_revision integer NOT NULL DEFAULT 0 CHECK (draft_revision >= 0),
  setup_context jsonb NOT NULL,
  familiarity text NOT NULL DEFAULT 'unanswered' CHECK (familiarity IN ('unanswered', 'familiar', 'not_recalled')),
  consent_at timestamptz NOT NULL,
  disclosure_version text NOT NULL,
  practice_goal text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source_attempt_id IS NULL) = (source_checkpoint_id IS NULL))
);

CREATE TABLE attempt_events (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES attempts(id),
  event_type text NOT NULL,
  source_id text NOT NULL,
  source_order integer NOT NULL CHECK (source_order >= 0),
  occurrence_offset_ms integer NOT NULL CHECK (occurrence_offset_ms >= 0),
  server_received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, source_id),
  UNIQUE (attempt_id, source_id, source_order)
);

CREATE TABLE transcript_segments (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES attempts(id),
  event_id text NOT NULL REFERENCES attempt_events(id),
  speaker text NOT NULL CHECK (speaker IN ('candidate', 'interviewer', 'coach', 'system')),
  text text NOT NULL,
  end_offset_ms integer NOT NULL CHECK (end_offset_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE code_checkpoints (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES attempts(id),
  event_id text NOT NULL REFERENCES attempt_events(id),
  source_code text NOT NULL,
  checkpoint_type text NOT NULL CHECK (checkpoint_type IN ('run', 'save', 'submission', 'retry_source')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

ALTER TABLE attempts ADD CONSTRAINT attempts_source_checkpoint_fk
  FOREIGN KEY (source_checkpoint_id) REFERENCES code_checkpoints(id);

CREATE TABLE code_runs (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES attempts(id),
  checkpoint_id text NOT NULL REFERENCES code_checkpoints(id),
  event_id text NOT NULL REFERENCES attempt_events(id),
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'runner_error', 'running')),
  tests_passed integer NOT NULL DEFAULT 0 CHECK (tests_passed >= 0),
  tests_failed integer NOT NULL DEFAULT 0 CHECK (tests_failed >= 0),
  stdout text NOT NULL DEFAULT '',
  stderr text NOT NULL DEFAULT '',
  execution_time_ms integer CHECK (execution_time_ms >= 0),
  runner_error text,
  test_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_kind text NOT NULL CHECK (run_kind IN ('visible', 'submission')),
  runner_version text NOT NULL,
  harness_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id)
);

CREATE TABLE assistance_events (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES attempts(id),
  event_id text NOT NULL REFERENCES attempt_events(id),
  category text NOT NULL CHECK (category IN ('clarification', 'hint', 'explanation')),
  offered boolean NOT NULL DEFAULT false,
  accepted boolean NOT NULL DEFAULT false,
  delivered boolean NOT NULL DEFAULT false,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id),
  CHECK (delivered = false OR accepted = true)
);

CREATE TABLE attempt_audio (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES attempts(id),
  object_key text NOT NULL UNIQUE,
  start_offset_ms integer NOT NULL CHECK (start_offset_ms >= 0),
  end_offset_ms integer NOT NULL CHECK (end_offset_ms >= start_offset_ms),
  media_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'available', 'failed', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviews (
  id text PRIMARY KEY,
  attempt_id text NOT NULL UNIQUE REFERENCES attempts(id),
  status text NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  evaluator_version text,
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  evidence_manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_findings (
  id text PRIMARY KEY,
  review_id text NOT NULL REFERENCES reviews(id),
  observation text NOT NULL,
  interpretation text,
  limitations text NOT NULL,
  suggested_action text,
  criterion text,
  evidence_status text NOT NULL CHECK (evidence_status IN ('reproducible_observation', 'supported_interpretation', 'tentative_interpretation', 'insufficient_evidence')),
  retry_checkpoint_id text REFERENCES code_checkpoints(id),
  practice_goal text,
  assistance_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finding_evidence (
  id text PRIMARY KEY,
  finding_id text NOT NULL REFERENCES review_findings(id),
  event_id text NOT NULL REFERENCES attempt_events(id),
  locator jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, event_id)
);

CREATE TABLE finding_corrections (
  id text PRIMARY KEY,
  finding_id text NOT NULL REFERENCES review_findings(id),
  user_id text NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attempts_owner_history_idx ON attempts (user_id, updated_at DESC);
CREATE INDEX attempt_events_timeline_idx ON attempt_events (attempt_id, occurrence_offset_ms, source_id, source_order);
CREATE INDEX code_checkpoints_attempt_idx ON code_checkpoints (attempt_id, created_at DESC);
CREATE INDEX code_runs_attempt_idx ON code_runs (attempt_id, created_at DESC);
CREATE INDEX related_problems_source_idx ON related_problems (source_problem_id);

-- The details below are append-only; they must never point at another attempt.
CREATE FUNCTION enforce_attempt_detail_membership() RETURNS trigger AS $$
DECLARE detail_attempt_id text;
BEGIN
  IF TG_TABLE_NAME = 'transcript_segments' THEN
    SELECT attempt_id INTO detail_attempt_id FROM attempt_events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'code_checkpoints' THEN
    SELECT attempt_id INTO detail_attempt_id FROM attempt_events WHERE id = NEW.event_id;
  ELSIF TG_TABLE_NAME = 'code_runs' THEN
    SELECT attempt_id INTO detail_attempt_id FROM attempt_events WHERE id = NEW.event_id;
    IF detail_attempt_id = NEW.attempt_id AND NOT EXISTS (SELECT 1 FROM code_checkpoints WHERE id = NEW.checkpoint_id AND attempt_id = NEW.attempt_id) THEN
      RAISE EXCEPTION 'checkpoint must belong to the run attempt';
    END IF;
  ELSIF TG_TABLE_NAME = 'assistance_events' THEN
    SELECT attempt_id INTO detail_attempt_id FROM attempt_events WHERE id = NEW.event_id;
  END IF;
  IF detail_attempt_id IS DISTINCT FROM NEW.attempt_id THEN
    RAISE EXCEPTION 'event must belong to the same attempt';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transcript_attempt_membership BEFORE INSERT OR UPDATE ON transcript_segments FOR EACH ROW EXECUTE FUNCTION enforce_attempt_detail_membership();
CREATE TRIGGER checkpoint_attempt_membership BEFORE INSERT OR UPDATE ON code_checkpoints FOR EACH ROW EXECUTE FUNCTION enforce_attempt_detail_membership();
CREATE TRIGGER run_attempt_membership BEFORE INSERT OR UPDATE ON code_runs FOR EACH ROW EXECUTE FUNCTION enforce_attempt_detail_membership();
CREATE TRIGGER assistance_attempt_membership BEFORE INSERT OR UPDATE ON assistance_events FOR EACH ROW EXECUTE FUNCTION enforce_attempt_detail_membership();

-- A completed attempt is its own frozen evidence boundary. Review records and
-- corrections may still be added, but captured timeline material cannot be
-- inserted or changed afterward.
CREATE FUNCTION reject_completed_attempt_evidence() RETURNS trigger AS $$
DECLARE evidence_attempt_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    evidence_attempt_id := OLD.attempt_id;
  ELSE
    evidence_attempt_id := NEW.attempt_id;
  END IF;
  IF EXISTS (SELECT 1 FROM attempts WHERE id = evidence_attempt_id AND status = 'completed') THEN
    RAISE EXCEPTION 'completed attempt evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_after_completion BEFORE INSERT OR UPDATE OR DELETE ON attempt_events FOR EACH ROW EXECUTE FUNCTION reject_completed_attempt_evidence();
CREATE TRIGGER transcripts_after_completion BEFORE INSERT OR UPDATE OR DELETE ON transcript_segments FOR EACH ROW EXECUTE FUNCTION reject_completed_attempt_evidence();
CREATE TRIGGER checkpoints_after_completion BEFORE INSERT OR UPDATE OR DELETE ON code_checkpoints FOR EACH ROW EXECUTE FUNCTION reject_completed_attempt_evidence();
CREATE TRIGGER runs_after_completion BEFORE INSERT OR UPDATE OR DELETE ON code_runs FOR EACH ROW EXECUTE FUNCTION reject_completed_attempt_evidence();
CREATE TRIGGER assistance_after_completion BEFORE INSERT OR UPDATE OR DELETE ON assistance_events FOR EACH ROW EXECUTE FUNCTION reject_completed_attempt_evidence();
CREATE TRIGGER audio_after_completion BEFORE INSERT OR UPDATE OR DELETE ON attempt_audio FOR EACH ROW EXECUTE FUNCTION reject_completed_attempt_evidence();

CREATE FUNCTION enforce_retry_lineage() RETURNS trigger AS $$
BEGIN
  IF NEW.source_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM attempts source_attempt
      JOIN code_checkpoints source_checkpoint ON source_checkpoint.id = NEW.source_checkpoint_id
     WHERE source_attempt.id = NEW.source_attempt_id
       AND source_checkpoint.attempt_id = source_attempt.id
       AND source_attempt.problem_id = NEW.problem_id
  ) THEN
    RAISE EXCEPTION 'retry source must be a checkpoint from the source attempt for the same problem';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER retry_lineage BEFORE INSERT OR UPDATE ON attempts FOR EACH ROW EXECUTE FUNCTION enforce_retry_lineage();

CREATE FUNCTION enforce_review_evidence_membership() RETURNS trigger AS $$
DECLARE row_data jsonb;
BEGIN
  row_data := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'review_findings' AND row_data->>'retry_checkpoint_id' IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM reviews r
      JOIN code_checkpoints c ON c.id = row_data->>'retry_checkpoint_id'
     WHERE r.id = row_data->>'review_id' AND c.attempt_id = r.attempt_id
  ) THEN
    RAISE EXCEPTION 'finding retry checkpoint must belong to the reviewed attempt';
  ELSIF TG_TABLE_NAME = 'finding_evidence' AND NOT EXISTS (
    SELECT 1
      FROM review_findings f
      JOIN reviews r ON r.id = f.review_id
      JOIN attempt_events e ON e.id = row_data->>'event_id'
     WHERE f.id = row_data->>'finding_id' AND e.attempt_id = r.attempt_id
  ) THEN
    RAISE EXCEPTION 'finding evidence must belong to the reviewed attempt';
  ELSIF TG_TABLE_NAME = 'finding_corrections' AND NOT EXISTS (
    SELECT 1
      FROM review_findings f
      JOIN reviews r ON r.id = f.review_id
      JOIN attempts a ON a.id = r.attempt_id
     WHERE f.id = row_data->>'finding_id' AND a.user_id = row_data->>'user_id'
  ) THEN
    RAISE EXCEPTION 'only the reviewed attempt owner may correct a finding';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finding_retry_membership BEFORE INSERT OR UPDATE ON review_findings FOR EACH ROW EXECUTE FUNCTION enforce_review_evidence_membership();
CREATE TRIGGER finding_evidence_membership BEFORE INSERT OR UPDATE ON finding_evidence FOR EACH ROW EXECUTE FUNCTION enforce_review_evidence_membership();
CREATE TRIGGER correction_owner_membership BEFORE INSERT OR UPDATE ON finding_corrections FOR EACH ROW EXECUTE FUNCTION enforce_review_evidence_membership();

-- Authored seed content remains separate from the guided sample family.
INSERT INTO problems (id, problem_family_id, revision, title, topic, difficulty, prompt, starter_code, reference_solution, clarification_guidance, help_guidance, entry_point, test_contract, is_sample)
VALUES
  ('sum-odd-positions-v1', 'sum-odd-positions', 1, 'Sum odd positions', 'Sequences', 'Easy', 'Return the sum of values at odd indexes. Return 0 for an empty list.', 'def sum_odd_positions(values):\n    pass\n', 'def sum_odd_positions(values):\n    return sum(values[1::2])\n', 'Clarify that indexes start at zero, so index 1 is the first odd position.', 'Ask which indexes are included for a four-value list.', 'sum_odd_positions', '{"arguments":"values: list","return":"JSON-serializable return value","comparison":"exact JSON equality"}'::jsonb, false),
  ('count-rises-v1', 'count-rises', 1, 'Count rises', 'Sequences', 'Easy', 'Return how many readings are greater than the reading immediately before them.', 'def count_rises(values):\n    pass\n', 'def count_rises(values):\n    return sum(current > previous for previous, current in zip(values, values[1:]))\n', 'Clarify that the first reading has no prior value to compare.', 'Ask what pair is compared at each step.', 'count_rises', '{"arguments":"values: list","return":"JSON-serializable return value","comparison":"exact JSON equality"}'::jsonb, false);

INSERT INTO test_cases (id, problem_id, input_data, expected_output, visibility) VALUES
  ('sum-odd-empty-v1', 'sum-odd-positions-v1', '{"args":[[]]}'::jsonb, '0'::jsonb, 'visible'),
  ('sum-odd-values-v1', 'sum-odd-positions-v1', '{"args":[[4,7,2,9]]}'::jsonb, '16'::jsonb, 'visible'),
  ('count-rises-basic-v1', 'count-rises-v1', '{"args":[[3,5,5,8]]}'::jsonb, '2'::jsonb, 'visible');

INSERT INTO related_problems (id, source_problem_id, related_problem_id, relationship_reason) VALUES
  ('sequence-comparison-relation-v1', 'sum-odd-positions-v1', 'count-rises-v1', 'Both tasks require deliberate index selection while scanning a sequence.');
