ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS copyright_match_id uuid REFERENCES public.copyright_matches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finding_kind text NOT NULL DEFAULT 'scan_hit',
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.case_findings
  DROP CONSTRAINT IF EXISTS case_findings_kind_check;
ALTER TABLE public.case_findings
  ADD CONSTRAINT case_findings_kind_check CHECK (finding_kind IN ('scan_hit', 'copyright_match'));

-- Idempotency: one detection may only ever be attached to one case per owner.
CREATE UNIQUE INDEX IF NOT EXISTS case_findings_owner_scan_hit_uniq
  ON public.case_findings (user_id, scan_hit_id)
  WHERE scan_hit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS case_findings_owner_copyright_match_uniq
  ON public.case_findings (user_id, copyright_match_id)
  WHERE copyright_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS case_findings_case_idx ON public.case_findings (user_id, case_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_findings TO authenticated;
GRANT ALL ON public.case_findings TO service_role;