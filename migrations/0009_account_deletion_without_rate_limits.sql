-- Account deletion removes the user-keyed rate-limit rows from application code,
-- with the one list of prefixes in src/security.ts, in the same transaction.
-- This function keeps every other personal row.
CREATE OR REPLACE FUNCTION delete_user_account(target_user_id text) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.deleting_user_id', target_user_id, true);
  DELETE FROM finding_corrections WHERE user_id = target_user_id OR finding_id IN (
    SELECT f.id FROM review_findings f JOIN reviews r ON r.id = f.review_id WHERE r.attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id));
  DELETE FROM finding_evidence WHERE finding_id IN (
    SELECT f.id FROM review_findings f JOIN reviews r ON r.id = f.review_id WHERE r.attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id));
  DELETE FROM review_findings WHERE review_id IN (SELECT id FROM reviews WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id));
  DELETE FROM reviews WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM voice_reservations WHERE user_id = target_user_id OR attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM attempt_audio WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM assistance_events WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM code_runs WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM transcript_segments WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  -- Retries reference their source checkpoint, which references its attempt.
  UPDATE attempts SET source_attempt_id = NULL, source_checkpoint_id = NULL WHERE user_id = target_user_id AND source_attempt_id IS NOT NULL;
  DELETE FROM code_checkpoints WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM attempt_events WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = target_user_id);
  DELETE FROM attempts WHERE user_id = target_user_id;
  DELETE FROM auth_verifications WHERE value = target_user_id AND identifier LIKE 'reset-password:%';
  DELETE FROM users WHERE id = target_user_id;
  PERFORM set_config('app.deleting_user_id', '', true);
END;
$$ LANGUAGE plpgsql;
