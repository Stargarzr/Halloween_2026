CREATE TABLE IF NOT EXISTS public.auth_attempts (
 key text PRIMARY KEY,
 count integer NOT NULL,
 window_start timestamptz NOT NULL
);
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_attempts FROM anon,authenticated;
