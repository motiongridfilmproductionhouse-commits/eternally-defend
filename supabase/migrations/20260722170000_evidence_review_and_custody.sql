-- Human-review and evidence-preservation layer for defensible exports.
CREATE TYPE public.evidence_review_status AS ENUM (
  'AUTOMATED_LEAD', 'REVIEW_REQUIRED', 'REVIEWED_NO_VIOLATION',
  'REVIEWED_POTENTIAL_VIOLATION', 'ESCALATION_RECOMMENDED', 'LEGAL_REVIEW_REQUIRED'
);
CREATE TYPE public.evidence_content_position AS ENUM ('SUPPORTIVE','NEUTRAL','CRITICAL','HOSTILE','UNKNOWN');
CREATE TYPE public.evidence_statement_type AS ENUM ('FACT','OPINION','INSULT','THREAT','SATIRE','NEWS_REPORT','UNKNOWN');

CREATE TABLE public.evidence_item_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_hit_id uuid NOT NULL REFERENCES public.scan_hits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  review_status public.evidence_review_status NOT NULL DEFAULT 'REVIEW_REQUIRED',
  reviewer_name text, reviewer_role text, reviewed_at timestamptz,
  target_person text, exact_original_statement text, statement_language text,
  verified_english_translation text, video_start_timestamp numeric(12,3), video_end_timestamp numeric(12,3),
  speaker_identity text, content_context text,
  content_position public.evidence_content_position NOT NULL DEFAULT 'UNKNOWN',
  statement_type public.evidence_statement_type NOT NULL DEFAULT 'UNKNOWN',
  alleged_violation_type text[] NOT NULL DEFAULT '{}',
  violation_reason text, supporting_facts text, falsity_basis text, victim_impact text,
  confidence_score numeric(5,2) CHECK (confidence_score BETWEEN 0 AND 100),
  legal_review_required boolean NOT NULL DEFAULT true,
  recommended_action text, reviewer_notes text,
  reviewer_declaration_signed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  supersedes_review_id uuid REFERENCES public.evidence_item_reviews(id),
  CONSTRAINT actionable_review_complete CHECK (
    review_status NOT IN ('REVIEWED_POTENTIAL_VIOLATION','ESCALATION_RECOMMENDED','LEGAL_REVIEW_REQUIRED') OR
    (nullif(trim(exact_original_statement),'') IS NOT NULL AND video_start_timestamp IS NOT NULL AND
     nullif(trim(content_context),'') IS NOT NULL AND nullif(trim(violation_reason),'') IS NOT NULL AND
     cardinality(alleged_violation_type) > 0)
  )
);

CREATE TABLE public.evidence_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scan_hit_id uuid REFERENCES public.scan_hits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_filename text, object_type text NOT NULL, mime_type text, file_size bigint,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'), hashing_algorithm text NOT NULL DEFAULT 'SHA-256',
  hash_generated_at timestamptz, collector_identity text, acquisition_method text,
  source_url text, captured_at timestamptz NOT NULL, storage_object_path text, previous_hash text,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.evidence_chain_of_custody (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), evidence_object_id uuid NOT NULL REFERENCES public.evidence_objects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, event_number bigint GENERATED ALWAYS AS IDENTITY,
  event_at timestamptz NOT NULL DEFAULT now(), actor text NOT NULL, action text NOT NULL,
  source_location text, destination_location text, hash_before text, hash_after text,
  signature_log_reference text, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.evidence_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  export_type text NOT NULL CHECK (export_type IN ('PRELIMINARY_INTELLIGENCE','VERIFIED_EVIDENCE_PACKAGE')),
  report_id text NOT NULL, storage_path text, manifest_path text, final_pdf_sha256 text,
  readiness_failures text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_reviews_hit_idx ON public.evidence_item_reviews(scan_hit_id, created_at DESC);
CREATE INDEX evidence_objects_hit_idx ON public.evidence_objects(scan_hit_id, captured_at DESC);
CREATE INDEX evidence_custody_object_idx ON public.evidence_chain_of_custody(evidence_object_id, event_number);

ALTER TABLE public.evidence_item_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_chain_of_custody ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_report_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_reviews_owner_select ON public.evidence_item_reviews FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY evidence_reviews_owner_insert ON public.evidence_item_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY evidence_objects_owner_all ON public.evidence_objects FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY evidence_custody_owner_select ON public.evidence_chain_of_custody FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY evidence_custody_owner_insert ON public.evidence_chain_of_custody FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY evidence_exports_owner_select ON public.evidence_report_exports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY evidence_exports_owner_insert ON public.evidence_report_exports FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.evidence_item_reviews IS 'Append-only human review history; corrections supersede rather than mutate prior reviews.';
COMMENT ON TABLE public.evidence_chain_of_custody IS 'Append-only custody events. Update and delete policies are intentionally absent.';
