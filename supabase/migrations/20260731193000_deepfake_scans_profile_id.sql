-- Optional face-profile linkage for scan scoping.
ALTER TABLE public.deepfake_scans
  ADD COLUMN IF NOT EXISTS profile_id UUID;

COMMENT ON COLUMN public.deepfake_scans.profile_id IS
  'Optional deepfake_target_profiles.id used for face-verified scans';

CREATE INDEX IF NOT EXISTS deepfake_scans_profile_idx
  ON public.deepfake_scans (user_id, profile_id, created_at DESC);
