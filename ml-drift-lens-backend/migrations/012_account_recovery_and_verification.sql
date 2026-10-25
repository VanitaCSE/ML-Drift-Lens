BEGIN;

-- Add email_verified flag to app_users if not present
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;

-- Password reset tokens (storing SHA-256 token hash only, never plaintext)
CREATE TABLE IF NOT EXISTS public.password_reset_tokens (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
  ON public.password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user
  ON public.password_reset_tokens (user_id);

-- Email verification tokens (storing SHA-256 token hash only, never plaintext)
CREATE TABLE IF NOT EXISTS public.email_verification_tokens (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  token_hash varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_hash
  ON public.email_verification_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
  ON public.email_verification_tokens (user_id);

COMMIT;
