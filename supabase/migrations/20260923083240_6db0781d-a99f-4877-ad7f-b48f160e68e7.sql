ALTER TABLE public.prospect_identities
  ADD COLUMN IF NOT EXISTS known_works text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS linked_entities text[] NOT NULL DEFAULT '{}';