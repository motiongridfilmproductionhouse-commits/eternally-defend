-- Migration for Intimate Image & Deepfake Protection Module

CREATE TYPE sensitive_consent_status AS ENUM ('active', 'revoked', 'pending');
CREATE TYPE sensitive_job_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE sensitive_risk_level AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE sensitive_review_status AS ENUM (
  'POTENTIAL_MATCH',
  'CONFIRMED_CLIENT_MATCH',
  'CONFIRMED_UNAUTHORIZED_ENDORSEMENT',
  'POSSIBLE_DEEPFAKE',
  'POSSIBLE_NON_CONSENSUAL_INTIMATE_CONTENT',
  'LEGITIMATE_EDITORIAL_USE',
  'LICENSED_USE',
  'UNRELATED_PERSON',
  'FALSE_MATCH',
  'INSUFFICIENT_EVIDENCE'
);
CREATE TYPE sensitive_removal_status AS ENUM (
  'DETECTED',
  'HUMAN_REVIEW_REQUIRED',
  'CONFIRMED',
  'EVIDENCE_SECURED',
  'REMOVAL_PREPARED',
  'AWAITING_CLIENT_APPROVAL',
  'SUBMITTED',
  'UNDER_REVIEW',
  'REMOVED_FROM_SOURCE',
  'REMOVED_FROM_SEARCH',
  'PARTIALLY_REMOVED',
  'REJECTED',
  'ESCALATED',
  'REAPPEARED',
  'CLOSED'
);
CREATE TYPE hive_provider_status AS ENUM ('submitted', 'processing', 'completed', 'failed');

CREATE TABLE sensitive_protection_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  client_id text,
  protected_face_profile_id uuid REFERENCES protected_face_profiles(id),
  consent_status sensitive_consent_status DEFAULT 'pending',
  consent_version integer DEFAULT 1,
  monitoring_status boolean DEFAULT true,
  scan_frequency text DEFAULT 'daily',
  face_similarity_threshold float DEFAULT 0.85,
  explicit_threshold float DEFAULT 0.85,
  deepfake_threshold float DEFAULT 0.85,
  emergency_mode boolean DEFAULT false,
  emergency_expires_at timestamptz,
  assigned_reviewer_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE sensitive_profile_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES sensitive_protection_profiles(id) ON DELETE CASCADE,
  alias text NOT NULL,
  language text,
  alias_type text,
  active boolean DEFAULT true
);

CREATE TABLE sensitive_scan_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES sensitive_protection_profiles(id) ON DELETE CASCADE,
  job_type text,
  source text,
  status sensitive_job_status DEFAULT 'pending',
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  urls_discovered integer DEFAULT 0,
  media_processed integer DEFAULT 0,
  matches_found integer DEFAULT 0,
  hive_calls integer DEFAULT 0,
  error_message text
);

CREATE TABLE sensitive_scan_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES sensitive_protection_profiles(id) ON DELETE CASCADE,
  scan_job_id uuid REFERENCES sensitive_scan_jobs(id),
  source_url text,
  domain text,
  page_title text,
  media_type text,
  media_hash text,
  url_hash text,
  hive_task_id text,
  explicit_content_score float,
  nudity_score float,
  sexual_content_score float,
  suggestive_content_score float,
  ai_generated_score float,
  deepfake_score float,
  manipulation_score float,
  face_similarity float,
  matching_face_id text,
  duplicate_count integer DEFAULT 0,
  mirror_count integer DEFAULT 0,
  risk_level sensitive_risk_level DEFAULT 'LOW',
  review_status sensitive_review_status DEFAULT 'POTENTIAL_MATCH',
  detected_at timestamptz DEFAULT now()
);

CREATE TABLE sensitive_evidence (
  result_id uuid PRIMARY KEY REFERENCES sensitive_scan_results(id) ON DELETE CASCADE,
  private_object_key text,
  screenshot_object_key text,
  evidence_hash text,
  captured_at timestamptz DEFAULT now(),
  watermark_status boolean DEFAULT false,
  chain_of_custody jsonb
);

CREATE TABLE sensitive_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid REFERENCES sensitive_scan_results(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id),
  classification sensitive_review_status,
  notes text,
  reviewed_at timestamptz DEFAULT now()
);

CREATE TABLE sensitive_removal_cases (
  result_id uuid PRIMARY KEY REFERENCES sensitive_scan_results(id) ON DELETE CASCADE,
  client_id text,
  case_status sensitive_removal_status DEFAULT 'DETECTED',
  source_removal_status text,
  google_removal_status text,
  bing_removal_status text,
  prepared_at timestamptz,
  submitted_at timestamptz,
  resolved_at timestamptz
);

CREATE TABLE sensitive_source_domains (
  domain text PRIMARY KEY,
  risk_level sensitive_risk_level,
  provider text,
  last_seen_at timestamptz,
  monitoring_enabled boolean DEFAULT true
);

CREATE TABLE sensitive_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  result_id uuid REFERENCES sensitive_scan_results(id),
  action text,
  reason text,
  ip_address text,
  device_metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE hive_provider_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_job_id uuid REFERENCES sensitive_scan_jobs(id),
  result_id uuid REFERENCES sensitive_scan_results(id),
  hive_task_id text UNIQUE,
  request_type text,
  provider_status hive_provider_status DEFAULT 'submitted',
  submitted_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  latency_ms integer,
  retry_count integer DEFAULT 0,
  raw_result_private_reference text,
  error_message text
);

-- Row Level Security (RLS)

ALTER TABLE sensitive_protection_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_profile_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_scan_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_scan_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_removal_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_source_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive_provider_tasks ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own profile
CREATE POLICY select_own_sensitive_profile ON sensitive_protection_profiles FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY update_own_sensitive_profile ON sensitive_protection_profiles FOR UPDATE
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY insert_own_sensitive_profile ON sensitive_protection_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Aliases
CREATE POLICY select_own_aliases ON sensitive_profile_aliases FOR SELECT
  USING (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = sensitive_profile_aliases.profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY insert_own_aliases ON sensitive_profile_aliases FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY update_own_aliases ON sensitive_profile_aliases FOR UPDATE
  USING (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY delete_own_aliases ON sensitive_profile_aliases FOR DELETE
  USING (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Jobs
CREATE POLICY select_own_jobs ON sensitive_scan_jobs FOR SELECT
  USING (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = sensitive_scan_jobs.profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Results
CREATE POLICY select_own_results ON sensitive_scan_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = sensitive_scan_results.profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY update_own_results ON sensitive_scan_results FOR UPDATE
  USING (EXISTS (SELECT 1 FROM sensitive_protection_profiles p WHERE p.id = profile_id AND p.user_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Evidence
CREATE POLICY select_own_evidence ON sensitive_evidence FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM sensitive_scan_results r 
    JOIN sensitive_protection_profiles p ON p.id = r.profile_id 
    WHERE r.id = sensitive_evidence.result_id AND p.user_id = auth.uid()
  ) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Cases
CREATE POLICY select_own_cases ON sensitive_removal_cases FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM sensitive_scan_results r 
    JOIN sensitive_protection_profiles p ON p.id = r.profile_id 
    WHERE r.id = sensitive_removal_cases.result_id AND p.user_id = auth.uid()
  ) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- Others
CREATE POLICY select_own_reviews ON sensitive_reviews FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM sensitive_scan_results r 
    JOIN sensitive_protection_profiles p ON p.id = r.profile_id 
    WHERE r.id = sensitive_reviews.result_id AND p.user_id = auth.uid()
  ) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY insert_own_reviews ON sensitive_reviews FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM sensitive_scan_results r 
    JOIN sensitive_protection_profiles p ON p.id = r.profile_id 
    WHERE r.id = result_id AND p.user_id = auth.uid()
  ) OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY select_own_access_logs ON sensitive_access_logs FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
CREATE POLICY insert_own_access_logs ON sensitive_access_logs FOR INSERT
  WITH CHECK (user_id = auth.uid() OR EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE POLICY select_domains ON sensitive_source_domains FOR SELECT USING (true);
CREATE POLICY admin_all_hive ON hive_provider_tasks FOR ALL USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'));
