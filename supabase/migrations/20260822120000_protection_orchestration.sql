-- Automatic protection enrollment: canonical protected-subject profile +
-- per-module scan scheduler/state, built from data already verified during
-- onboarding (client_profiles, digital_assets, authorization_scopes). No
-- changes to KYC/liveness/authorization tables, deepfake_target_profiles,
-- deepfake_reference_faces, or existing face data.
--
-- protection_profiles ALREADY EXISTS IN PRODUCTION (confirmed by direct
-- schema inspection: 9 rows, columns user_id UUID NOT NULL and
-- status TEXT NOT NULL DEFAULT 'PENDING', 0 duplicate user_id, 8 'ACTIVE' +
-- 1 'PENDING_AUTHORIZATION'). An earlier version of this migration used
-- CREATE TABLE IF NOT EXISTS, which would have been a silent no-op against
-- that real table — none of the canonical-profile columns the application
-- code needs would ever have been added. This version instead upgrades the
-- existing table in place:
--   * adds a real `id` UUID, backfilled per-row via an explicit UPDATE
--     (never via ADD COLUMN's own DEFAULT, which — because gen_random_uuid()
--     is volatile — cannot be trusted not to evaluate once and stamp the
--     same UUID across every existing row; an explicit UPDATE has
--     unambiguous per-row semantics)
--   * adds a primary key on id and a unique constraint on user_id, each
--     only if not already present
--   * adds every new canonical column via ADD COLUMN IF NOT EXISTS
--   * never renames, drops, or overwrites the existing `status` column or
--     any of the 9 existing rows' values
--   * does NOT add protected_face_profile_id (see the companion Phase 2
--     migration's header comment: public.protected_face_profiles does not
--     exist in production)
-- protection_profile_aliases and scan_module_enrollments are genuinely new
-- tables (confirmed not present in production) and are created after
-- protection_profiles has a real id to reference.
--
-- Ends with assertions that abort the whole migration transaction (RAISE
-- EXCEPTION) if any of the following don't hold: no existing row was lost,
-- every existing (user_id, status) pair is unchanged, every row has a
-- non-null id, no duplicate user_id rows exist, and the two new tables'
-- foreign keys correctly reference protection_profiles(id).

-- ============ SAFETY SNAPSHOT (compared against post-migration state below) ============
DROP TABLE IF EXISTS _protection_profiles_pre_migration_snapshot;
CREATE TEMP TABLE _protection_profiles_pre_migration_snapshot AS
SELECT user_id, status FROM public.protection_profiles;

-- ============ CANONICAL PROTECTION PROFILE (in-place upgrade) ============

-- 1-3. Add id, backfill per-row, then enforce NOT NULL.
ALTER TABLE public.protection_profiles ADD COLUMN IF NOT EXISTS id UUID;

UPDATE public.protection_profiles SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE public.protection_profiles ALTER COLUMN id SET NOT NULL;

-- Default for FUTURE inserts only — set as a separate step, after existing
-- rows are already backfilled, so it can never apply to them.
ALTER TABLE public.protection_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- 4. Primary key on id, only if the table doesn't already have one.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'protection_profiles'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE public.protection_profiles ADD CONSTRAINT protection_profiles_pkey PRIMARY KEY (id);
  END IF;
END $$;

-- 5. Unique constraint on user_id, only if one doesn't already exist.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'protection_profiles'
      AND tc.constraint_type = 'UNIQUE' AND ccu.column_name = 'user_id'
  ) THEN
    ALTER TABLE public.protection_profiles ADD CONSTRAINT protection_profiles_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 6. `status` is untouched above and below — no rename, no drop, no rewrite.

-- 7. New canonical-profile columns. Left nullable with no default (except
-- official_socials, a structural default, and built_at/updated_at, safe
-- bookkeeping timestamps) so nothing here asserts a fact about the 9
-- existing rows that isn't actually known yet — buildOrUpdateProtectionProfile
-- populates the real values the next time it runs for that user.
ALTER TABLE public.protection_profiles
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS authorization_id UUID REFERENCES public.client_authorizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_name TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS profession_category TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS official_website TEXT,
  ADD COLUMN IF NOT EXISTS official_socials JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS protection_status TEXT,
  ADD COLUMN IF NOT EXISTS source_onboarding_version TEXT,
  ADD COLUMN IF NOT EXISTS built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 8. protected_face_profile_id deliberately NOT added — see header comment.

-- Indexes / grants / RLS / trigger — safe to (re-)apply whether or not the
-- pre-existing table already had any of these.
CREATE INDEX IF NOT EXISTS protection_profiles_user_idx ON public.protection_profiles(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protection_profiles TO authenticated;
GRANT ALL ON public.protection_profiles TO service_role;
ALTER TABLE public.protection_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own protection profile" ON public.protection_profiles
  FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin protection profile read" ON public.protection_profiles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE TRIGGER trg_protection_profiles_updated BEFORE UPDATE ON public.protection_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ NEW TABLES (only created now that protection_profiles.id is real) ============

-- 10. protection_profile_aliases — confirmed not present in production.
CREATE TABLE IF NOT EXISTS public.protection_profile_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.protection_profiles(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  language TEXT,
  alias_type TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS protection_profile_aliases_profile_idx
  ON public.protection_profile_aliases(profile_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.protection_profile_aliases TO authenticated;
GRANT ALL ON public.protection_profile_aliases TO service_role;
ALTER TABLE public.protection_profile_aliases ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own protection aliases" ON public.protection_profile_aliases
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.protection_profiles p
            WHERE p.id = protection_profile_aliases.profile_id AND p.user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin protection aliases read" ON public.protection_profile_aliases
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 10. scan_module_enrollments — confirmed not present in production.
CREATE TABLE IF NOT EXISTS public.scan_module_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES public.protection_profiles(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  eligible BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cadence_minutes INTEGER NOT NULL DEFAULT 1440,
  last_scan_at TIMESTAMPTZ,
  next_scan_at TIMESTAMPTZ,
  current_status TEXT NOT NULL DEFAULT 'WAITING_FOR_NEXT_SCAN',
  current_run_id TEXT,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  verified_findings INTEGER NOT NULL DEFAULT 0,
  provider_failures INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  last_success_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_key)
);
CREATE INDEX IF NOT EXISTS scan_module_enrollments_due_idx
  ON public.scan_module_enrollments (next_scan_at)
  WHERE enabled AND eligible;
CREATE INDEX IF NOT EXISTS scan_module_enrollments_user_idx
  ON public.scan_module_enrollments(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_module_enrollments TO authenticated;
GRANT ALL ON public.scan_module_enrollments TO service_role;
ALTER TABLE public.scan_module_enrollments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own scan enrollments" ON public.scan_module_enrollments
  FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin scan enrollments read" ON public.scan_module_enrollments
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE OR REPLACE TRIGGER trg_scan_module_enrollments_updated BEFORE UPDATE ON public.scan_module_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ ASSERTIONS (13): abort the whole migration if any fail ============
DO $$
DECLARE
  pre_count INTEGER;
  post_count INTEGER;
  missing_or_changed_count INTEGER;
  null_id_count INTEGER;
  dup_user_count INTEGER;
  aliases_fk_ok BOOLEAN;
  enrollments_fk_ok BOOLEAN;
BEGIN
  SELECT count(*) INTO pre_count FROM _protection_profiles_pre_migration_snapshot;
  SELECT count(*) INTO post_count FROM public.protection_profiles;

  -- All existing rows survive.
  IF post_count < pre_count THEN
    RAISE EXCEPTION
      'protection_profiles migration assertion FAILED: row count dropped from % to %',
      pre_count, post_count;
  END IF;

  -- User IDs unchanged, statuses unchanged: every pre-existing (user_id,
  -- status) pair must still exist exactly as it was.
  SELECT count(*) INTO missing_or_changed_count
  FROM _protection_profiles_pre_migration_snapshot s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.protection_profiles p
    WHERE p.user_id = s.user_id AND p.status = s.status
  );
  IF missing_or_changed_count > 0 THEN
    RAISE EXCEPTION
      'protection_profiles migration assertion FAILED: % pre-existing rows have a changed or missing user_id/status',
      missing_or_changed_count;
  END IF;

  -- Every row (old and any new) has a real id.
  SELECT count(*) INTO null_id_count FROM public.protection_profiles WHERE id IS NULL;
  IF null_id_count > 0 THEN
    RAISE EXCEPTION
      'protection_profiles migration assertion FAILED: % rows still have a null id',
      null_id_count;
  END IF;

  -- No duplicate user_id rows were introduced.
  SELECT count(*) INTO dup_user_count FROM (
    SELECT user_id FROM public.protection_profiles GROUP BY user_id HAVING count(*) > 1
  ) d;
  IF dup_user_count > 0 THEN
    RAISE EXCEPTION
      'protection_profiles migration assertion FAILED: % duplicate user_id groups found',
      dup_user_count;
  END IF;

  -- protection_profile_aliases.profile_id and scan_module_enrollments.profile_id
  -- both correctly FK to the newly-real protection_profiles(id).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'protection_profile_aliases'
      AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'profile_id'
      AND ccu.table_name = 'protection_profiles' AND ccu.column_name = 'id'
  ) INTO aliases_fk_ok;
  IF NOT aliases_fk_ok THEN
    RAISE EXCEPTION
      'protection_profiles migration assertion FAILED: protection_profile_aliases.profile_id is not FK-ed to protection_profiles(id)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = 'scan_module_enrollments'
      AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'profile_id'
      AND ccu.table_name = 'protection_profiles' AND ccu.column_name = 'id'
  ) INTO enrollments_fk_ok;
  IF NOT enrollments_fk_ok THEN
    RAISE EXCEPTION
      'protection_profiles migration assertion FAILED: scan_module_enrollments.profile_id is not FK-ed to protection_profiles(id)';
  END IF;

  RAISE NOTICE
    'protection_profiles migration assertions PASSED: % rows preserved unchanged, all ids populated, no duplicates, both new tables correctly FK-ed.',
    post_count;
END $$;

DROP TABLE IF EXISTS _protection_profiles_pre_migration_snapshot;
