-- Landing experiments (#24). Only `experiment_exposed` events set these columns: the experiment,
-- the variant and its copy version the document showed, and whether the document is eligible.
ALTER TABLE measurement_events
  ADD COLUMN IF NOT EXISTS experiment_id text,
  ADD COLUMN IF NOT EXISTS variant text,
  ADD COLUMN IF NOT EXISTS variant_version text,
  ADD COLUMN IF NOT EXISTS eligibility text CHECK (eligibility IN ('eligible', 'automation', 'internal'));
CREATE INDEX IF NOT EXISTS measurement_events_experiment_idx ON measurement_events (experiment_id, received_at) WHERE experiment_id IS NOT NULL;
