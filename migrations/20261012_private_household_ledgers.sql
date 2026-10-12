-- No legacy UID-based import: a supplied identifier cannot prove ownership.
CREATE TABLE IF NOT EXISTS public.private_household_ledgers (
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 data jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.private_household_ledgers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_household_ledgers FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_household_ledgers TO service_role;
