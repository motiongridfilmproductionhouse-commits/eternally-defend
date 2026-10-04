CREATE UNIQUE INDEX IF NOT EXISTS cases_enforcement_request_uidx
  ON public.cases ((metadata->>'enforcement_request_id'))
  WHERE metadata ? 'enforcement_request_id';

CREATE OR REPLACE FUNCTION public.sync_case_from_enforcement_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m jsonb := COALESCE(NEW.metadata, '{}'::jsonb);
  v_status text;
  v_type text;
  v_notes text;
  v_closed timestamptz;
  v_removed boolean;
BEGIN
  IF NEW.status NOT IN ('Sent','Approved','Rejected') THEN
    RETURN NEW;
  END IF;

  v_removed := NEW.status = 'Approved' OR m->>'outcome' = 'removed';
  v_status := CASE
    WHEN v_removed THEN 'Closed'
    WHEN m->>'escalation_status' IS NOT NULL OR NEW.status = 'Rejected' THEN 'Escalated'
    ELSE 'In Progress'
  END;
  v_type := CASE NEW.method WHEN 'DMCA' THEN 'DMCA' WHEN 'Legal Notice' THEN 'Legal' ELSE 'Platform' END;
  v_closed := CASE WHEN v_removed THEN COALESCE((m->>'removed_at')::timestamptz, now()) ELSE NULL END;
  v_notes := concat_ws(' · ',
    CASE WHEN v_removed THEN 'Content removed' WHEN NEW.status = 'Rejected' THEN 'Platform rejected the report' ELSE 'Removal request submitted' END,
    CASE WHEN m ? 'removed_video_count' THEN (m->>'removed_video_count') || ' video(s) removed' END,
    CASE WHEN m ? 'escalation_status' THEN 'Escalated to manual removal team' END,
    CASE WHEN m ? 'intellectual_property_report_number' THEN 'Report #' || (m->>'intellectual_property_report_number') END
  );

  INSERT INTO public.cases (user_id, subject, type, status, priority, opened_at, closed_at, notes, metadata)
  VALUES (
    NEW.user_id,
    COALESCE(NEW.platform, 'Platform') || ' removal request',
    v_type, v_status, 'High',
    COALESCE(NEW.submitted_at, NEW.created_at),
    v_closed, v_notes,
    jsonb_build_object(
      'enforcement_request_id', NEW.id::text,
      'source', 'enforcement_request',
      'target_url', NEW.target_url,
      'platform', NEW.platform,
      'report_number', m->>'intellectual_property_report_number',
      'removed_video_count', m->'removed_video_count'
    )
  )
  ON CONFLICT ((metadata->>'enforcement_request_id')) WHERE metadata ? 'enforcement_request_id'
  DO UPDATE SET
    status = EXCLUDED.status,
    closed_at = EXCLUDED.closed_at,
    notes = EXCLUDED.notes,
    metadata = public.cases.metadata || EXCLUDED.metadata;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_case_from_enforcement_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforcement_requests_sync_case ON public.enforcement_requests;
CREATE TRIGGER trg_enforcement_requests_sync_case
AFTER INSERT OR UPDATE OF status, metadata ON public.enforcement_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_case_from_enforcement_request();

-- Backfill: open cases for removal requests that already exist
UPDATE public.enforcement_requests SET metadata = metadata
WHERE status IN ('Sent','Approved','Rejected');