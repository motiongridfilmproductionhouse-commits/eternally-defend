CREATE OR REPLACE FUNCTION public.agent_create_assessment(p_actor uuid, p_name text, p_url text, p_key text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing uuid; result uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text, 0));
  IF NOT (EXISTS (SELECT 1 FROM agent_memberships WHERE user_id=p_actor AND active)
    OR has_role(p_actor,'admin') OR has_role(p_actor,'super_admin')) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT id INTO existing FROM agent_assessments WHERE agent_id=p_actor AND dedup_key=p_key
    AND created_at > now()-interval '2 minutes' AND status NOT IN ('FAILED','EXPIRED') ORDER BY created_at DESC LIMIT 1;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  IF (SELECT count(*) FROM agent_assessments WHERE agent_id=p_actor AND created_at > now()-interval '1 hour') >= 10
     OR (SELECT count(*) FROM agent_assessments WHERE agent_id=p_actor AND created_at > now()-interval '1 day') >= 40
  THEN RAISE EXCEPTION 'Assessment limit reached. Please try again later.'; END IF;
  INSERT INTO agent_assessments(agent_id,artist_name,official_profile_url,dedup_key)
    VALUES(p_actor,p_name,p_url,p_key) RETURNING id INTO result;
  INSERT INTO agent_assessment_audit(assessment_id,actor_id,action) VALUES(result,p_actor,'SCAN_REQUESTED');
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.agent_create_assessment(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_create_assessment(uuid,text,text,text) TO service_role;