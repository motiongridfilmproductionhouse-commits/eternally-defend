-- Review Queue + admin-only Takedown for Approved YouTube Sources.
--
-- Today the automatic pipeline (analyze-approved-video.server.ts) is the
-- sole decision-maker on a discovered video. This migration adds the
-- columns/table needed so every discovered video instead lands in a
-- customer-facing review queue: the customer can mark it
-- 'approved_legitimate' or 'sent_for_review' (neither ever creates an
-- enforcement case), and only an authorized admin can move a video to
-- 'takedown_requested' via a separate, audited action.
--
-- Purely additive: no existing table is dropped/altered destructively, and
-- neither existing RLS policy on approved_youtube_sources or
-- approved_source_videos is touched. Two new admin-only SELECT policies are
-- added (mirroring the existing "admin automated finding evidence read"
-- policy pattern) so an admin's own authenticated client can read across
-- tenants for the review queue; all cross-tenant WRITES still require the
-- service-role client, gated by an explicit has_role() check in the admin
-- server function before it's ever called.

ALTER TABLE public.approved_source_videos
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN (
      'pending_review', 'approved_legitimate', 'sent_for_review', 'takedown_requested'
    )),
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS approved_source_videos_review_status_idx
  ON public.approved_source_videos(review_status)
  WHERE review_status IN ('pending_review', 'sent_for_review');

-- Additive admin-read visibility only (SELECT). Existing owner-only policies
-- on both tables are unchanged; a non-admin still only ever sees their own
-- rows via those. This lets the admin review-queue list use the admin's own
-- authenticated client (same pattern as listPendingReviews in
-- src/lib/onboarding/admin.functions.ts) instead of a service-role client.
DO $$ BEGIN
  CREATE POLICY "admin read approved youtube sources" ON public.approved_youtube_sources
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin read approved source videos" ON public.approved_source_videos
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Append-only audit trail for the admin Takedown action. video_id has no
-- cascade-delete, matching approved_source_videos.source_id's own
-- no-cascade rationale: an audit record must outlive the row it describes.
CREATE TABLE IF NOT EXISTS public.approved_source_takedown_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.approved_source_videos(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL DEFAULT 'takedown_requested',
  reason TEXT,
  enforcement_case_id UUID REFERENCES public.enforcement_cases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approved_source_takedown_log_video_idx
  ON public.approved_source_takedown_log(video_id);
CREATE INDEX IF NOT EXISTS approved_source_takedown_log_user_idx
  ON public.approved_source_takedown_log(user_id);

-- SELECT only, no UPDATE/DELETE grant at all — append-only, mirroring
-- automated_finding_evidence_captures' convention.
GRANT SELECT, INSERT ON public.approved_source_takedown_log TO authenticated;
GRANT ALL ON public.approved_source_takedown_log TO service_role;
ALTER TABLE public.approved_source_takedown_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "own takedown log read" ON public.approved_source_takedown_log
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin takedown log read" ON public.approved_source_takedown_log
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "admin takedown log insert" ON public.approved_source_takedown_log
    FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Deliberately no UPDATE or DELETE policy of any kind: with RLS enabled and
-- no matching policy, both commands are denied to `authenticated` outright.

-- ============ VERIFICATION QUERIES (read-only, run after applying) ============
-- SELECT column_name FROM information_schema.columns WHERE table_schema='public'
-- AND table_name='approved_source_videos' AND column_name IN ('review_status','reviewed_by','reviewed_at');
--
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
-- AND table_name = 'approved_source_takedown_log';
--
-- Confirm the pre-existing owner-only policies are untouched (still exactly one each):
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.approved_youtube_sources'::regclass;
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.approved_source_videos'::regclass;
--
-- Confirm no existing row was touched:
-- SELECT count(*) FROM public.approved_youtube_sources; -- unchanged from before
-- SELECT count(*) FROM public.approved_source_videos;   -- unchanged from before
