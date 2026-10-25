BEGIN;

ALTER TABLE public.predictions
  ADD COLUMN IF NOT EXISTS actual_label_source varchar(255),
  ADD COLUMN IF NOT EXISTS actual_label_verified_at timestamptz,
  DROP CONSTRAINT IF EXISTS predictions_verified_label_provenance_check,
  ADD CONSTRAINT predictions_verified_label_provenance_check
    CHECK (
      actual_label_verified_at IS NULL
      OR (
        actual_label IS NOT NULL
        AND NULLIF(BTRIM(actual_label_source), '') IS NOT NULL
      )
    );

ALTER TABLE public.retraining_jobs
  ADD COLUMN IF NOT EXISTS status varchar(40),
  ADD COLUMN IF NOT EXISTS trigger_reason varchar(255),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_samples integer NOT NULL DEFAULT 150,
  ADD COLUMN IF NOT EXISTS sample_count integer,
  ADD COLUMN IF NOT EXISTS evaluation_sample_count integer,
  ADD COLUMN IF NOT EXISTS candidate_metrics jsonb,
  ADD COLUMN IF NOT EXISTS promotion_reason varchar(255),
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

UPDATE public.retraining_jobs
SET status = CASE
  WHEN promoted THEN 'deployed'
  WHEN new_model_version IS NOT NULL THEN 'candidate_ready'
  ELSE 'failed'
END
WHERE status IS NULL;

ALTER TABLE public.retraining_jobs
  ALTER COLUMN status SET DEFAULT 'queued',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.retraining_jobs
  DROP CONSTRAINT IF EXISTS retraining_jobs_status_check,
  ADD CONSTRAINT retraining_jobs_status_check
    CHECK (status IN (
      'queued',
      'collecting_data',
      'waiting_for_labelled_data',
      'validating_data',
      'training',
      'evaluating',
      'candidate_ready',
      'rejected',
      'deploying',
      'deployed',
      'failed',
      'cancelled'
    )),
  DROP CONSTRAINT IF EXISTS retraining_jobs_attempt_count_check,
  ADD CONSTRAINT retraining_jobs_attempt_count_check CHECK (attempt_count >= 0),
  DROP CONSTRAINT IF EXISTS retraining_jobs_min_samples_check,
  ADD CONSTRAINT retraining_jobs_min_samples_check CHECK (min_samples > 0),
  DROP CONSTRAINT IF EXISTS retraining_jobs_sample_count_check,
  ADD CONSTRAINT retraining_jobs_sample_count_check CHECK (sample_count IS NULL OR sample_count >= 0),
  DROP CONSTRAINT IF EXISTS retraining_jobs_evaluation_sample_count_check,
  ADD CONSTRAINT retraining_jobs_evaluation_sample_count_check
    CHECK (evaluation_sample_count IS NULL OR evaluation_sample_count >= 0);

CREATE INDEX IF NOT EXISTS idx_retraining_jobs_status_updated
  ON public.retraining_jobs (status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retraining_jobs_one_active_per_model
  ON public.retraining_jobs (model_id)
  WHERE status IN (
    'queued',
    'collecting_data',
    'waiting_for_labelled_data',
    'validating_data',
    'training',
    'evaluating',
    'deploying'
  );

CREATE INDEX IF NOT EXISTS idx_predictions_verified_labels
  ON public.predictions (model_id, actual_label_verified_at, timestamp DESC)
  WHERE actual_label IS NOT NULL AND actual_label_verified_at IS NOT NULL;

COMMIT;
