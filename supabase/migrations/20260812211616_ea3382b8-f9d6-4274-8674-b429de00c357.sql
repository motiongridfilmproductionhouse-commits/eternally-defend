ALTER TABLE public.protected_faces
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE public.protected_faces
  DROP CONSTRAINT IF EXISTS protected_faces_status_check;
ALTER TABLE public.protected_faces
  ADD CONSTRAINT protected_faces_status_check CHECK (status IN ('ACTIVE','INACTIVE'));

UPDATE public.protected_faces SET last_verified_at = COALESCE(last_verified_at, created_at);
UPDATE public.protected_faces SET source = COALESCE(source, platform, 'unknown');

CREATE UNIQUE INDEX IF NOT EXISTS protected_faces_user_face_uniq
  ON public.protected_faces(user_id, face_id);
CREATE INDEX IF NOT EXISTS protected_faces_user_status_idx
  ON public.protected_faces(user_id, status);