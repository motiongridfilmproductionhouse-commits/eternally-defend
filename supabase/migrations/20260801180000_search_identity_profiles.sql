-- Identity-Aware Search Expansion profiles (shared across Eterna search modules).
-- Stores resolved canonical identity + alias provenance. Never overwrite
-- reviewer-approved / user-provided aliases with AI-discovered ones (enforced in app).

CREATE TABLE IF NOT EXISTS public.search_identity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  corrected_name text,
  entity_type text NOT NULL DEFAULT 'unknown',
  aliases text[] NOT NULL DEFAULT '{}',
  aliases_detailed jsonb NOT NULL DEFAULT '[]'::jsonb,
  local_language_names text[] NOT NULL DEFAULT '{}',
  former_names text[] NOT NULL DEFAULT '{}',
  nicknames text[] NOT NULL DEFAULT '{}',
  official_handles text[] NOT NULL DEFAULT '{}',
  related_shows text[] NOT NULL DEFAULT '{}',
  related_films text[] NOT NULL DEFAULT '{}',
  character_names text[] NOT NULL DEFAULT '{}',
  professions text[] NOT NULL DEFAULT '{}',
  organizations text[] NOT NULL DEFAULT '{}',
  identity_confidence double precision NOT NULL DEFAULT 0,
  identity_ambiguous boolean NOT NULL DEFAULT false,
  reviewer_confirmed boolean NOT NULL DEFAULT false,
  identity_last_resolved_at timestamptz,
  identity_resolution_source text[] NOT NULL DEFAULT '{}',
  last_expansion jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, canonical_name)
);

CREATE INDEX IF NOT EXISTS search_identity_profiles_user_idx
  ON public.search_identity_profiles (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS search_identity_profiles_canonical_idx
  ON public.search_identity_profiles (canonical_name);

ALTER TABLE public.search_identity_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "search_identity_profiles_select_own"
  ON public.search_identity_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "search_identity_profiles_insert_own"
  ON public.search_identity_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "search_identity_profiles_update_own"
  ON public.search_identity_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "search_identity_profiles_delete_own"
  ON public.search_identity_profiles FOR DELETE
  USING (auth.uid() = user_id);
