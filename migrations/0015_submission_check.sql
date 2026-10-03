-- The Submission check (#45, docs/adr/0002): a Run with run_kind 'submission' that stores
-- only an outcome category for each hidden test. Visible Runs keep every column as before.
-- An unavailable check, or a Problem with no hidden tests, has no runner result and no counts.
ALTER TABLE code_runs
  ADD COLUMN check_state text CHECK (check_state IN ('checked', 'unavailable', 'no hidden tests')),
  ALTER COLUMN status DROP NOT NULL,
  ALTER COLUMN tests_passed DROP NOT NULL,
  ALTER COLUMN tests_failed DROP NOT NULL,
  ALTER COLUMN runner_version DROP NOT NULL,
  ALTER COLUMN harness_version DROP NOT NULL,
  ADD CONSTRAINT code_runs_submission_check CHECK (
    (run_kind = 'visible' AND check_state IS NULL AND status IS NOT NULL AND tests_passed IS NOT NULL AND tests_failed IS NOT NULL
      AND runner_version IS NOT NULL AND harness_version IS NOT NULL)
    OR (run_kind = 'submission' AND check_state = 'checked' AND status IN ('passed', 'failed') AND tests_passed IS NOT NULL AND tests_failed IS NOT NULL
      AND runner_version IS NOT NULL AND harness_version IS NOT NULL AND stdout = '' AND stderr = '' AND runner_error IS NULL AND execution_time_ms IS NULL)
    OR (run_kind = 'submission' AND check_state IN ('unavailable', 'no hidden tests') AND status IS NULL AND tests_passed IS NULL AND tests_failed IS NULL
      AND runner_version IS NULL AND harness_version IS NULL AND stdout = '' AND stderr = '' AND runner_error IS NULL AND execution_time_ms IS NULL AND test_results = '[]'::jsonb)
  );
-- One Submission check per Attempt.
CREATE UNIQUE INDEX IF NOT EXISTS code_runs_one_submission_check ON code_runs (attempt_id) WHERE run_kind = 'submission';
