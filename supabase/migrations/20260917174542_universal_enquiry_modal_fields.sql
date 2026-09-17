-- Universal enquiry modal: extend the existing waitlist_signups table and
-- join_waitlist RPC with the richer, structured fields the shared enquiry
-- modal collects (department, protection service, profile type, message,
-- platforms, relevant URL, source attribution). This intentionally reuses
-- the SAME table and RPC that every existing "Request Protection" /
-- "Contact Eterna" CTA already writes to (via /waitinglist) rather than
-- creating a second lead store. All new columns are nullable and every new
-- RPC parameter defaults to NULL, so every existing caller of
-- join_waitlist (the plain /waitinglist page/server function) keeps
-- working unchanged.
--
-- NOTE: this migration has not been applied to the live project from this
-- environment (no supabase CLI / project credentials available here). It
-- must be reviewed and run (`supabase db push` or the SQL editor) before
-- the enquiry modal's submissions will actually persist the new fields.

ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS enquiry_department text,
  ADD COLUMN IF NOT EXISTS protection_service text,
  ADD COLUMN IF NOT EXISTS profile_type text,
  ADD COLUMN IF NOT EXISTS profile_name text,
  ADD COLUMN IF NOT EXISTS role_title text,
  ADD COLUMN IF NOT EXISTS security_topic text,
  ADD COLUMN IF NOT EXISTS privacy_topic text,
  ADD COLUMN IF NOT EXISTS partnership_type text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS platforms text[],
  ADD COLUMN IF NOT EXISTS relevant_url text,
  ADD COLUMN IF NOT EXISTS source_page text,
  ADD COLUMN IF NOT EXISTS source_cta text;

-- The original 12-parameter overload is dropped and replaced by one with
-- the same first 12 parameters (unchanged order, names and defaults) plus
-- new trailing optional parameters, so PostgREST's named-parameter dispatch
-- keeps resolving both the existing /waitinglist caller and the new
-- enquiry-modal caller to this single function.
DROP FUNCTION IF EXISTS public.join_waitlist(text,text,text,text,text,text,text,text,text,text,text,text);

CREATE OR REPLACE FUNCTION public.join_waitlist(
  p_full_name text,
  p_email text,
  p_email_normalized text,
  p_phone text,
  p_phone_normalized text,
  p_persona text,
  p_organization text DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_enquiry_department text DEFAULT NULL,
  p_protection_service text DEFAULT NULL,
  p_profile_type text DEFAULT NULL,
  p_profile_name text DEFAULT NULL,
  p_role_title text DEFAULT NULL,
  p_security_topic text DEFAULT NULL,
  p_privacy_topic text DEFAULT NULL,
  p_partnership_type text DEFAULT NULL,
  p_media_type text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_platforms text[] DEFAULT NULL,
  p_relevant_url text DEFAULT NULL,
  p_source_page text DEFAULT NULL,
  p_source_cta text DEFAULT NULL,
  p_id_prefix text DEFAULT 'ET-WL-'
)
RETURNS TABLE (result_status text, result_waitlist_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing text;
  v_id text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_prefix text := CASE WHEN p_id_prefix IS NULL OR btrim(p_id_prefix) = '' THEN 'ET-WL-' ELSE p_id_prefix END;
  i int;
BEGIN
  IF p_full_name IS NULL OR length(btrim(p_full_name)) < 2
     OR p_email_normalized IS NULL OR position('@' in p_email_normalized) < 2
     OR p_phone_normalized IS NULL OR length(p_phone_normalized) < 7
     OR p_persona NOT IN ('Student','Individual','Professional','Organization') THEN
    RETURN QUERY SELECT 'INVALID'::text, NULL::text;
    RETURN;
  END IF;

  SELECT w.waitlist_id INTO v_existing
  FROM public.waitlist_signups w
  WHERE w.email_normalized = p_email_normalized
     OR w.phone_normalized = p_phone_normalized
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_JOINED'::text, v_existing;
    RETURN;
  END IF;

  v_id := v_prefix;
  FOR i IN 1..6 LOOP
    v_id := v_id || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  END LOOP;

  BEGIN
    INSERT INTO public.waitlist_signups (
      waitlist_id, full_name, email, email_normalized, phone, phone_normalized,
      persona, organization, source, utm_source, utm_medium, utm_campaign, referrer,
      enquiry_department, protection_service, profile_type, profile_name, role_title,
      security_topic, privacy_topic, partnership_type, media_type, message, platforms,
      relevant_url, source_page, source_cta
    ) VALUES (
      v_id, btrim(p_full_name), p_email, p_email_normalized, p_phone, p_phone_normalized,
      p_persona, NULLIF(btrim(coalesce(p_organization,'')),''), p_source,
      p_utm_source, p_utm_medium, p_utm_campaign, p_referrer,
      p_enquiry_department, p_protection_service, p_profile_type,
      NULLIF(btrim(coalesce(p_profile_name,'')),''), NULLIF(btrim(coalesce(p_role_title,'')),''),
      p_security_topic, p_privacy_topic, p_partnership_type, p_media_type,
      NULLIF(btrim(coalesce(p_message,'')),''), p_platforms,
      NULLIF(btrim(coalesce(p_relevant_url,'')),''), p_source_page, p_source_cta
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT w.waitlist_id INTO v_existing
    FROM public.waitlist_signups w
    WHERE w.email_normalized = p_email_normalized
       OR w.phone_normalized = p_phone_normalized
    LIMIT 1;
    RETURN QUERY SELECT 'ALREADY_JOINED'::text, v_existing;
    RETURN;
  END;

  RETURN QUERY SELECT 'JOINED'::text, v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_waitlist(
  text,text,text,text,text,text,text,text,text,text,text,text,
  text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_waitlist(
  text,text,text,text,text,text,text,text,text,text,text,text,
  text,text,text,text,text,text,text,text,text,text,text[],text,text,text,text
) TO anon, authenticated, service_role;
