CREATE TYPE public.prospect_scan_status AS ENUM ('queued','running','completed','partial','failed','cancelled');
CREATE TYPE public.prospect_source_state AS ENUM ('not_scanned','connecting','scanning','results_found','no_results','unavailable','provider_error','policy_disabled');
CREATE TYPE public.prospect_capability_status AS ENUM ('ran','unavailable');
CREATE TYPE public.prospect_identity_bucket AS ENUM ('MATCHED','POSSIBLE_MATCH','NEEDS_IDENTITY_REVIEW','UNRELATED');
CREATE TYPE public.prospect_finding_state AS ENUM ('DISCOVERED','CLASSIFIED','NEEDS_HUMAN_REVIEW','VERIFIED','REJECTED','ESCALATED');
CREATE TYPE public.prospect_coverage_state AS ENUM ('COMPLETE','PARTIAL','LIMITED','INSUFFICIENT');
CREATE TYPE public.prospect_risk_band AS ENUM ('INSUFFICIENT_DATA','PENDING_VERIFICATION','LOW','MODERATE','HIGH','CRITICAL');
CREATE TYPE public.prospect_score_kind AS ENUM ('PRELIMINARY_EXPOSURE','VERIFIED_RISK');

CREATE OR REPLACE FUNCTION public.is_prospect_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('staff','admin','super_admin')
  );
$$;
REVOKE ALL ON FUNCTION public.is_prospect_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_prospect_staff(uuid) TO authenticated, service_role;

CREATE TABLE public.prospect_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  identity_type text NOT NULL DEFAULT 'individual',
  country_region text,
  known_profile_url text,
  known_website text,
  profession text,
  organization text,
  aliases text[] NOT NULL DEFAULT '{}',
  known_handles jsonb NOT NULL DEFAULT '[]'::jsonb,
  name_is_ambiguous boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.prospect_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospect_identities(id) ON DELETE RESTRICT,
  status public.prospect_scan_status NOT NULL DEFAULT 'queued',
  stage text,
  source_family_set_version text NOT NULL,
  classification_version text NOT NULL,
  query_terms text[] NOT NULL DEFAULT '{}',
  aliases_used text[] NOT NULL DEFAULT '{}',
  families_intended integer NOT NULL DEFAULT 0,
  families_queried_ok integer NOT NULL DEFAULT 0,
  families_failed integer NOT NULL DEFAULT 0,
  families_unavailable integer NOT NULL DEFAULT 0,
  families_policy_disabled integer NOT NULL DEFAULT 0,
  coverage_state public.prospect_coverage_state,
  error_message text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_scans_prospect_idx ON public.prospect_scans(prospect_id, created_at DESC);

CREATE TABLE public.prospect_scan_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  family_key text NOT NULL,
  family_label text NOT NULL,
  direct_access boolean NOT NULL DEFAULT false,
  weight_class text NOT NULL DEFAULT 'supporting',
  state public.prospect_source_state NOT NULL DEFAULT 'not_scanned',
  providers text[] NOT NULL DEFAULT '{}',
  queries_issued integer NOT NULL DEFAULT 0,
  raw_results integer NOT NULL DEFAULT 0,
  unique_items integer NOT NULL DEFAULT 0,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, family_key)
);

CREATE TABLE public.prospect_scan_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  analysis_key text NOT NULL,
  status public.prospect_capability_status NOT NULL,
  reason text,
  candidates_considered integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, analysis_key)
);

CREATE TABLE public.prospect_scan_events (
  id bigserial PRIMARY KEY,
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  stage text,
  family_key text,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_scan_events_scan_idx ON public.prospect_scan_events(scan_id, id);

CREATE TABLE public.prospect_discoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospect_identities(id) ON DELETE RESTRICT,
  family_key text NOT NULL,
  platform text,
  discovery_method text NOT NULL,
  original_url text NOT NULL,
  canonical_url text NOT NULL,
  content_fingerprint text NOT NULL DEFAULT '',
  media_hash text,
  title text,
  snippet text,
  page_excerpt text,
  extraction_status text,
  author text,
  published_at timestamptz,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  identity_bucket public.prospect_identity_bucket NOT NULL DEFAULT 'NEEDS_IDENTITY_REVIEW',
  identity_confidence integer NOT NULL DEFAULT 0,
  identity_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  identity_explanation text,
  identity_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  identity_approved_at timestamptz,
  classification text,
  classification_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, canonical_url, content_fingerprint)
);
CREATE INDEX prospect_discoveries_scan_idx ON public.prospect_discoveries(scan_id, created_at);
CREATE INDEX prospect_discoveries_bucket_idx ON public.prospect_discoveries(scan_id, identity_bucket);

CREATE TABLE public.prospect_discovery_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discovery_id uuid NOT NULL REFERENCES public.prospect_discoveries(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_result_id text,
  family_key text NOT NULL,
  query_used text,
  result_rank integer,
  raw_url text NOT NULL,
  raw_excerpt text,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_observations_discovery_idx ON public.prospect_discovery_observations(discovery_id);

CREATE TABLE public.prospect_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospect_identities(id) ON DELETE RESTRICT,
  discovery_id uuid NOT NULL REFERENCES public.prospect_discoveries(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  category text NOT NULL,
  severity text,
  detection_reason text NOT NULL,
  confidence integer,
  state public.prospect_finding_state NOT NULL DEFAULT 'DISCOVERED',
  classification_version text NOT NULL,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  staff_classification text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, discovery_id, stage_key, category)
);
CREATE INDEX prospect_findings_scan_idx ON public.prospect_findings(scan_id, stage_key, state);

CREATE TABLE public.prospect_finding_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.prospect_findings(id) ON DELETE CASCADE,
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  capture_path text,
  capture_kind text,
  extracted_text text,
  content_hash text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_finding_evidence_finding_idx ON public.prospect_finding_evidence(finding_id);

CREATE TABLE public.prospect_propagation_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  cluster_key text NOT NULL,
  member_count integer NOT NULL DEFAULT 0,
  earliest_discovery_id uuid REFERENCES public.prospect_discoveries(id) ON DELETE SET NULL,
  origin_established boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, cluster_key)
);

CREATE TABLE public.prospect_cluster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES public.prospect_propagation_clusters(id) ON DELETE CASCADE,
  discovery_id uuid NOT NULL REFERENCES public.prospect_discoveries(id) ON DELETE CASCADE,
  link_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_earliest_discovered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, discovery_id)
);

CREATE TABLE public.prospect_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  score_kind public.prospect_score_kind NOT NULL,
  model_version text NOT NULL,
  band public.prospect_risk_band NOT NULL,
  total_points integer NOT NULL DEFAULT 0,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage_state public.prospect_coverage_state,
  findings_considered integer NOT NULL DEFAULT 0,
  findings_awaiting_verification integer NOT NULL DEFAULT 0,
  computed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_risk_scores_scan_idx ON public.prospect_risk_scores(scan_id, score_kind, created_at DESC);

CREATE TABLE public.prospect_staff_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  finding_id uuid REFERENCES public.prospect_findings(id) ON DELETE CASCADE,
  discovery_id uuid REFERENCES public.prospect_discoveries(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  previous_state text,
  new_state text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_staff_decisions_scan_idx ON public.prospect_staff_decisions(scan_id, created_at DESC);
CREATE INDEX prospect_staff_decisions_finding_idx ON public.prospect_staff_decisions(finding_id, new_state);

CREATE TABLE public.prospect_enrollment_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.prospect_scans(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospect_identities(id) ON DELETE RESTRICT,
  finding_id uuid REFERENCES public.prospect_findings(id) ON DELETE CASCADE,
  target_table text NOT NULL,
  target_id uuid,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  transferred_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scan_id, finding_id, target_table)
);

GRANT SELECT, INSERT, UPDATE ON public.prospect_identities TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_scans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_scan_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_scan_capabilities TO authenticated;
GRANT SELECT, INSERT ON public.prospect_scan_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.prospect_scan_events_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_discoveries TO authenticated;
GRANT SELECT, INSERT ON public.prospect_discovery_observations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_findings TO authenticated;
GRANT SELECT, INSERT ON public.prospect_finding_evidence TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_propagation_clusters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.prospect_cluster_members TO authenticated;
GRANT SELECT, INSERT ON public.prospect_risk_scores TO authenticated;
GRANT SELECT, INSERT ON public.prospect_staff_decisions TO authenticated;
GRANT SELECT, INSERT ON public.prospect_enrollment_transfers TO authenticated;

GRANT ALL ON public.prospect_identities TO service_role;
GRANT ALL ON public.prospect_scans TO service_role;
GRANT ALL ON public.prospect_scan_sources TO service_role;
GRANT ALL ON public.prospect_scan_capabilities TO service_role;
GRANT ALL ON public.prospect_scan_events TO service_role;
GRANT ALL ON SEQUENCE public.prospect_scan_events_id_seq TO service_role;
GRANT ALL ON public.prospect_discoveries TO service_role;
GRANT ALL ON public.prospect_discovery_observations TO service_role;
GRANT ALL ON public.prospect_findings TO service_role;
GRANT ALL ON public.prospect_finding_evidence TO service_role;
GRANT ALL ON public.prospect_propagation_clusters TO service_role;
GRANT ALL ON public.prospect_cluster_members TO service_role;
GRANT ALL ON public.prospect_risk_scores TO service_role;
GRANT ALL ON public.prospect_staff_decisions TO service_role;
GRANT ALL ON public.prospect_enrollment_transfers TO service_role;

ALTER TABLE public.prospect_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_scan_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_scan_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_scan_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_discoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_discovery_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_finding_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_propagation_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_cluster_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_staff_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_enrollment_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage prospect identities" ON public.prospect_identities FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff manage prospect scans" ON public.prospect_scans FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff manage prospect scan sources" ON public.prospect_scan_sources FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff manage prospect capabilities" ON public.prospect_scan_capabilities FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff read prospect events" ON public.prospect_scan_events FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff append prospect events" ON public.prospect_scan_events FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff read prospect discoveries" ON public.prospect_discoveries FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff insert prospect discoveries" ON public.prospect_discoveries FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff update prospect discoveries" ON public.prospect_discoveries FOR UPDATE TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff read prospect observations" ON public.prospect_discovery_observations FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff append prospect observations" ON public.prospect_discovery_observations FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff manage prospect findings" ON public.prospect_findings FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff read prospect evidence" ON public.prospect_finding_evidence FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff append prospect evidence" ON public.prospect_finding_evidence FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff manage prospect clusters" ON public.prospect_propagation_clusters FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff manage prospect cluster members" ON public.prospect_cluster_members FOR ALL TO authenticated USING (public.is_prospect_staff(auth.uid())) WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff read prospect scores" ON public.prospect_risk_scores FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff append prospect scores" ON public.prospect_risk_scores FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff read prospect decisions" ON public.prospect_staff_decisions FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff append prospect decisions" ON public.prospect_staff_decisions FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()) AND actor_id = auth.uid());
CREATE POLICY "Staff read prospect transfers" ON public.prospect_enrollment_transfers FOR SELECT TO authenticated USING (public.is_prospect_staff(auth.uid()));
CREATE POLICY "Staff append prospect transfers" ON public.prospect_enrollment_transfers FOR INSERT TO authenticated WITH CHECK (public.is_prospect_staff(auth.uid()));

CREATE TRIGGER trg_prospect_identities_updated BEFORE UPDATE ON public.prospect_identities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prospect_scans_updated BEFORE UPDATE ON public.prospect_scans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prospect_scan_sources_updated BEFORE UPDATE ON public.prospect_scan_sources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prospect_capabilities_updated BEFORE UPDATE ON public.prospect_scan_capabilities FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prospect_findings_updated BEFORE UPDATE ON public.prospect_findings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_prospect_clusters_updated BEFORE UPDATE ON public.prospect_propagation_clusters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_prospect_scan_events_append_only BEFORE UPDATE OR DELETE ON public.prospect_scan_events FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();
CREATE TRIGGER trg_prospect_observations_append_only BEFORE UPDATE OR DELETE ON public.prospect_discovery_observations FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();
CREATE TRIGGER trg_prospect_evidence_append_only BEFORE UPDATE OR DELETE ON public.prospect_finding_evidence FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();
CREATE TRIGGER trg_prospect_scores_append_only BEFORE UPDATE OR DELETE ON public.prospect_risk_scores FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();
CREATE TRIGGER trg_prospect_decisions_append_only BEFORE UPDATE OR DELETE ON public.prospect_staff_decisions FOR EACH ROW EXECUTE FUNCTION public.enforcement_audit_append_only();

CREATE OR REPLACE FUNCTION public.prospect_discoveries_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'prospect_discoveries is append-only' USING ERRCODE = '42501';
  END IF;
  IF NEW.scan_id IS DISTINCT FROM OLD.scan_id
     OR NEW.prospect_id IS DISTINCT FROM OLD.prospect_id
     OR NEW.original_url IS DISTINCT FROM OLD.original_url
     OR NEW.canonical_url IS DISTINCT FROM OLD.canonical_url
     OR NEW.content_fingerprint IS DISTINCT FROM OLD.content_fingerprint
     OR NEW.discovery_method IS DISTINCT FROM OLD.discovery_method
     OR NEW.family_key IS DISTINCT FROM OLD.family_key
     OR NEW.retrieved_at IS DISTINCT FROM OLD.retrieved_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'prospect_discoveries provenance columns are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_prospect_discoveries_guard BEFORE UPDATE OR DELETE ON public.prospect_discoveries FOR EACH ROW EXECUTE FUNCTION public.prospect_discoveries_guard();

CREATE OR REPLACE FUNCTION public.prospect_findings_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.state::text IN ('VERIFIED','REJECTED','ESCALATED') THEN
    IF NEW.verified_by IS NULL OR NEW.verified_at IS NULL THEN
      RAISE EXCEPTION 'prospect_findings: % requires a staff actor (verified_by/verified_at)', NEW.state
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_prospect_staff(NEW.verified_by) THEN
      RAISE EXCEPTION 'prospect_findings: verified_by must be a staff user' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.prospect_staff_decisions d
      WHERE d.finding_id = NEW.id AND d.actor_id = NEW.verified_by AND d.new_state = NEW.state::text
    ) THEN
      RAISE EXCEPTION 'prospect_findings: an audited staff decision must accompany state %', NEW.state
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_prospect_findings_state_guard BEFORE INSERT OR UPDATE ON public.prospect_findings FOR EACH ROW EXECUTE FUNCTION public.prospect_findings_state_guard();

ALTER TABLE public.prospect_scan_events REPLICA IDENTITY FULL;
ALTER TABLE public.prospect_discoveries REPLICA IDENTITY FULL;
ALTER TABLE public.prospect_findings REPLICA IDENTITY FULL;
ALTER TABLE public.prospect_scan_sources REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prospect_scan_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prospect_discoveries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prospect_findings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prospect_scan_sources;