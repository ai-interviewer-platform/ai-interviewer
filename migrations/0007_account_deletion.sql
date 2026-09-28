-- Account deletion is the only path that may remove completed evidence.
-- delete_user_account() sets a transaction-local user ID; the immutability
-- trigger permits DELETE (never INSERT or UPDATE) only for that user's attempts.
CREATE OR REPLACE FUNCTION reject_completed_attempt_evidence() RETURNS trigger AS $$
DECLARE evidence_attempt_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    evidence_attempt_id := OLD.attempt_id;
  ELSE
    evidence_attempt_id := NEW.attempt_id;
  END IF;
  IF EXISTS (SELECT 1 FROM attempts WHERE id = evidence_attempt_id AND status = 'completed')
     AND NOT (TG_OP = 'DELETE' AND EXISTS (
       SELECT 1 FROM attempts WHERE id = evidence_attempt_id AND user_id = current_setting('app.deleting_user_id', true)
     )) THEN
    RAISE EXCEPTION 'completed attempt evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Removes the user and every personal row in one statement. Auth sessions and
-- accounts cascade from users. Problems and test cases are shared content.
CREATE FUNCTION delete_user_account(target_user_id text) RETURNS void AS $$
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
  DELETE FROM security_rate_limits WHERE key IN ('api:' || target_user_id, 'account-delete:' || target_user_id);
  DELETE FROM auth_verifications WHERE value = target_user_id AND identifier LIKE 'reset-password:%';
  DELETE FROM users WHERE id = target_user_id;
  PERFORM set_config('app.deleting_user_id', '', true);
END;
$$ LANGUAGE plpgsql;
