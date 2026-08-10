-- Production Readiness Migration for Route Intelligence & Metrics

ALTER TABLE public.domain_enforcement_routes
  ADD COLUMN IF NOT EXISTS contact_type TEXT DEFAULT 'COPYRIGHT',
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS hosting_provider TEXT,
  ADD COLUMN IF NOT EXISTS registrar TEXT,
  ADD COLUMN IF NOT EXISTS confidence FLOAT DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS submission_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_accepted_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounce_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_removed_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS average_response_time_ms INT;

-- Function to record route outcome statistics
CREATE OR REPLACE FUNCTION public.record_route_outcome(
  p_domain TEXT,
  p_outcome TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.domain_enforcement_routes
  SET
    submission_count = CASE WHEN p_outcome = 'SUBMITTED' THEN submission_count + 1 ELSE submission_count END,
    provider_accepted_count = CASE WHEN p_outcome = 'PROVIDER_ACCEPTED' THEN provider_accepted_count + 1 ELSE provider_accepted_count END,
    delivered_count = CASE WHEN p_outcome = 'DELIVERED' THEN delivered_count + 1 ELSE delivered_count END,
    bounce_count = CASE WHEN p_outcome = 'BOUNCED' OR p_outcome = 'DELIVERY_FAILED' THEN bounce_count + 1 ELSE bounce_count END,
    source_removed_count = CASE WHEN p_outcome = 'SOURCE_REMOVED' THEN source_removed_count + 1 ELSE source_removed_count END,
    rejected_count = CASE WHEN p_outcome = 'REJECTED' THEN rejected_count + 1 ELSE rejected_count END,
    last_success_at = CASE WHEN p_outcome IN ('DELIVERED', 'SOURCE_REMOVED', 'PROVIDER_ACCEPTED') THEN now() ELSE last_success_at END,
    last_failure_at = CASE WHEN p_outcome IN ('BOUNCED', 'DELIVERY_FAILED', 'REJECTED') THEN now() ELSE last_failure_at END,
    updated_at = now()
  WHERE domain = p_domain;
END;
$$;
