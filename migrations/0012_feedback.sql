-- Contextual feedback (#21). No account, email, attempt or record identifier: only the
-- question version, page context and the original response, plus private triage fields.
CREATE TABLE IF NOT EXISTS feedback_responses (
  id text PRIMARY KEY,
  question_id text NOT NULL,
  question_version integer NOT NULL,
  feature text NOT NULL,
  surface text NOT NULL,
  activity text NOT NULL CHECK (activity IN ('none', 'sample', 'personal')),
  answer text,
  response_text text,
  -- feedbackCategories, feedbackStatuses and closedFeedbackStatuses of public/feedback-questions.js.
  category text CHECK (category IN ('usability', 'content', 'bug', 'feature_request', 'praise', 'other')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'planned', 'resolved', 'declined')),
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (answer IS NOT NULL OR response_text IS NOT NULL),
  CHECK (status NOT IN ('resolved', 'declined') OR resolution IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS feedback_responses_triage_idx ON feedback_responses (status, created_at DESC);

-- Triage changes only category, status and resolution; the original response stays as given.
CREATE OR REPLACE FUNCTION preserve_feedback_response() RETURNS trigger AS $$
BEGIN
  IF (NEW.id, NEW.question_id, NEW.question_version, NEW.feature, NEW.surface, NEW.activity, NEW.answer, NEW.response_text, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.question_id, OLD.question_version, OLD.feature, OLD.surface, OLD.activity, OLD.answer, OLD.response_text, OLD.created_at) THEN
    RAISE EXCEPTION 'original feedback is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS feedback_responses_preserved ON feedback_responses;
CREATE TRIGGER feedback_responses_preserved BEFORE UPDATE ON feedback_responses FOR EACH ROW EXECUTE FUNCTION preserve_feedback_response();
