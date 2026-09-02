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
  p_referrer text DEFAULT NULL
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

  v_id := 'ET-WL-';
  FOR i IN 1..6 LOOP
    v_id := v_id || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  END LOOP;

  BEGIN
    INSERT INTO public.waitlist_signups (
      waitlist_id, full_name, email, email_normalized, phone, phone_normalized,
      persona, organization, source, utm_source, utm_medium, utm_campaign, referrer
    ) VALUES (
      v_id, btrim(p_full_name), p_email, p_email_normalized, p_phone, p_phone_normalized,
      p_persona, NULLIF(btrim(coalesce(p_organization,'')),''), p_source,
      p_utm_source, p_utm_medium, p_utm_campaign, p_referrer
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

REVOKE ALL ON FUNCTION public.join_waitlist(text,text,text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_waitlist(text,text,text,text,text,text,text,text,text,text,text,text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.waitlist_public_count()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.waitlist_signups;
$$;

REVOKE ALL ON FUNCTION public.waitlist_public_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.waitlist_public_count() TO anon, authenticated, service_role;