-- Migration: 20260812110000_web_scan_progress.sql
-- Description: Minimal persisted progress store for the Web Scan live-status UI.
--
-- This is deliberately NOT a durable/resumable background-job table (no lease,
-- no checkpoint cursor, no worker-continuation columns). The scan pipeline
-- (src/routes/api/scan.ts) still runs inline in a single client-triggered
-- request; this table only lets that same request report real, small progress
-- checkpoints so the frontend's ScanRadar can show genuine stages/counters
-- instead of a coarse "running" fallback. If the triggering request is
-- aborted (tab closed, browser refreshed), the scan stops exactly as it does
-- today — this table does not change that.
--
-- user_id is intentionally nullable and left unpopulated: /api/scan has no
-- server-side auth check today (no createServerFn middleware, no session
-- parsing), and this table matches that existing posture rather than adding
-- a new auth requirement. Access is by knowledge of the random scanRunId,
-- the same trust boundary the endpoint already has.

CREATE TABLE public.web_scan_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  query TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'INITIALIZING',
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  providers JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT chk_web_scan_progress_status CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  CONSTRAINT chk_web_scan_progress_stage CHECK (
    stage IN (
      'INITIALIZING', 'QUERY_GENERATION', 'DISCOVERY', 'AI_RESEARCH', 'AI_EXPANSION',
      'EXTRACTION', 'IDENTITY_VERIFICATION', 'EVIDENCE_ANALYSIS', 'RANKING',
      'FINALIZING', 'COMPLETE', 'FAILED'
    )
  )
);

CREATE INDEX idx_web_scan_progress_started ON public.web_scan_progress(started_at DESC);

-- Server-side only (supabaseAdmin) — no policy grants direct client access,
-- matching /api/scan's existing unauthenticated-at-the-route posture without
-- opening a new direct-table read/write surface to arbitrary clients.
ALTER TABLE public.web_scan_progress ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.web_scan_progress TO service_role;

CREATE TRIGGER trg_web_scan_progress_updated_at
  BEFORE UPDATE ON public.web_scan_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
