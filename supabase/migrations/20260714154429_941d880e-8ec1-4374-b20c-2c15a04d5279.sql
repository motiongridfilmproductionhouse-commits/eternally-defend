
-- 1. enforcement_requests
CREATE TABLE public.enforcement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_hit_id uuid REFERENCES public.scan_hits(id) ON DELETE SET NULL,
  platform text NOT NULL,
  method text NOT NULL CHECK (method IN ('DMCA','Platform Report','Legal Notice','Manual')),
  target_url text,
  status text NOT NULL DEFAULT 'Queued' CHECK (status IN ('Queued','Sent','Approved','Rejected','Withdrawn')),
  submitted_at timestamptz,
  responded_at timestamptz,
  response_notes text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enforcement_requests TO authenticated;
GRANT ALL ON public.enforcement_requests TO service_role;
ALTER TABLE public.enforcement_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own enforcement_requests" ON public.enforcement_requests
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_enforcement_requests_user ON public.enforcement_requests(user_id, created_at DESC);
CREATE INDEX idx_enforcement_requests_status ON public.enforcement_requests(user_id, status);
CREATE TRIGGER trg_enforcement_requests_updated_at
  BEFORE UPDATE ON public.enforcement_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. cases
CREATE TABLE public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  type text NOT NULL CHECK (type IN ('DMCA','Legal','Platform','Investigation')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Escalated','Closed')),
  priority text NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Critical','High','Medium','Low')),
  assignee text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own cases" ON public.cases
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_cases_user ON public.cases(user_id, opened_at DESC);
CREATE TRIGGER trg_cases_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. case_findings
CREATE TABLE public.case_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  scan_hit_id uuid REFERENCES public.scan_hits(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, scan_hit_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_findings TO authenticated;
GRANT ALL ON public.case_findings TO service_role;
ALTER TABLE public.case_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own case_findings" ON public.case_findings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_case_findings_case ON public.case_findings(case_id);

-- 4. generated_reports
CREATE TABLE public.generated_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'Executive Summary',
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Generating','Ready','Failed')),
  pdf_url text,
  findings_count integer NOT NULL DEFAULT 0,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_reports TO authenticated;
GRANT ALL ON public.generated_reports TO service_role;
ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own generated_reports" ON public.generated_reports
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_generated_reports_user ON public.generated_reports(user_id, created_at DESC);
CREATE TRIGGER trg_generated_reports_updated_at
  BEFORE UPDATE ON public.generated_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
