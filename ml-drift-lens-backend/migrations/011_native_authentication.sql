BEGIN;

CREATE TABLE IF NOT EXISTS public.app_users (
  id bigserial PRIMARY KEY,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT app_users_email_lowercase_check CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
  sid varchar NOT NULL PRIMARY KEY,
  sess json NOT NULL,
  expire timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expire
  ON public.user_sessions (expire);

COMMIT;
