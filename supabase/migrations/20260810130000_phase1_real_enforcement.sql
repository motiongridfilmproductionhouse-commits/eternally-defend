-- Phase 1 Real External Auto Enforcement Migration

-- 1. Extend domain_enforcement_routes for strict route verification
ALTER TABLE public.domain_enforcement_routes
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'VERIFIED',
  ADD COLUMN IF NOT EXISTS contact TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'SYSTEM_VERIFIED',
  ADD COLUMN IF NOT EXISTS verification_method TEXT DEFAULT 'WHOIS_RDAP_VERIFIED';

-- Mark initial seeded domain intel as VERIFIED
UPDATE public.domain_enforcement_routes
SET verification_status = 'VERIFIED',
    contact = COALESCE(copyright_email, abuse_email)
WHERE domain IN ('youtube.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'cloudflare.com');

-- 2. Atomic Job Claiming Function (SKIP LOCKED to prevent race conditions)
CREATE OR REPLACE FUNCTION public.claim_next_enforcement_job(p_worker_id TEXT)
RETURNS SETOF public.enforcement_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  SELECT id INTO v_job_id
  FROM public.enforcement_jobs
  WHERE status = 'queued' AND scheduled_at <= now()
  ORDER BY scheduled_at ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    RETURN QUERY
    UPDATE public.enforcement_jobs
    SET status = 'processing',
        locked_by = p_worker_id,
        locked_at = now(),
        attempts = attempts + 1,
        updated_at = now()
    WHERE id = v_job_id
    RETURNING *;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_enforcement_job(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_enforcement_job(TEXT) TO service_role;
