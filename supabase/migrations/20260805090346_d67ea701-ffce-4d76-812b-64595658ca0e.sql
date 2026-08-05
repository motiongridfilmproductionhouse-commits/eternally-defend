CREATE TABLE public.business_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_id TEXT,
  official_business_name TEXT NOT NULL,
  google_place_id TEXT,
  place_source TEXT NOT NULL DEFAULT 'google_places',
  place_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  website_domain TEXT,
  website_url TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  region TEXT,
  country TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  category TEXT,
  industry TEXT,
  google_maps_url TEXT,
  logo_url TEXT,
  rating NUMERIC,
  review_count INTEGER,
  business_status TEXT,
  selected_location TEXT,
  scan_scope TEXT NOT NULL DEFAULT 'branch',
  trading_name TEXT,
  parent_company TEXT,
  previous_names TEXT[] NOT NULL DEFAULT '{}',
  abbreviations TEXT[] NOT NULL DEFAULT '{}',
  branch_names TEXT[] NOT NULL DEFAULT '{}',
  executives TEXT[] NOT NULL DEFAULT '{}',
  products TEXT[] NOT NULL DEFAULT '{}',
  languages TEXT[] NOT NULL DEFAULT '{}',
  confirmed_at TIMESTAMP WITH TIME ZONE,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_profiles TO authenticated;
GRANT ALL ON public.business_profiles TO service_role;
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own business profiles" ON public.business_profiles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_business_profiles_updated_at BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_business_profiles_user ON public.business_profiles(user_id);
CREATE UNIQUE INDEX idx_business_profiles_user_place ON public.business_profiles(user_id, google_place_id) WHERE google_place_id IS NOT NULL;

CREATE TABLE public.business_place_selections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  google_place_id TEXT NOT NULL,
  display_name TEXT,
  formatted_address TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  scan_scope TEXT NOT NULL DEFAULT 'branch',
  selected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_place_selections TO authenticated;
GRANT ALL ON public.business_place_selections TO service_role;
ALTER TABLE public.business_place_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own place selections" ON public.business_place_selections FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.business_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'alternative',
  language TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_aliases TO authenticated;
GRANT ALL ON public.business_aliases TO service_role;
ALTER TABLE public.business_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own business aliases" ON public.business_aliases FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX idx_business_aliases_unique ON public.business_aliases(business_profile_id, lower(alias), alias_type);

CREATE TABLE public.business_social_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  username TEXT,
  profile_url TEXT,
  is_official BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_social_accounts TO authenticated;
GRANT ALL ON public.business_social_accounts TO service_role;
ALTER TABLE public.business_social_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own business socials" ON public.business_social_accounts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.business_scan_queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  query_type TEXT NOT NULL DEFAULT 'general',
  language TEXT,
  country TEXT,
  priority INTEGER NOT NULL DEFAULT 50,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_scan_queries TO authenticated;
GRANT ALL ON public.business_scan_queries TO service_role;
ALTER TABLE public.business_scan_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own business queries" ON public.business_scan_queries FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX idx_business_queries_unique ON public.business_scan_queries(business_profile_id, lower(query));

CREATE TABLE public.business_reputation_scans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_id TEXT,
  business_profile_id UUID NOT NULL REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  scan_scope TEXT NOT NULL DEFAULT 'branch',
  stage TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_reputation_scans TO authenticated;
GRANT ALL ON public.business_reputation_scans TO service_role;
ALTER TABLE public.business_reputation_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own business reputation scans" ON public.business_reputation_scans FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER update_business_reputation_scans_updated_at BEFORE UPDATE ON public.business_reputation_scans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();