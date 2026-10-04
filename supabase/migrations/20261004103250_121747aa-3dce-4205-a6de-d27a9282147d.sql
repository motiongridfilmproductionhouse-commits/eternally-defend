WITH inserted AS (
  INSERT INTO public.enforcement_requests (
    user_id,
    platform,
    method,
    target_url,
    status,
    submitted_at,
    responded_at,
    response_notes,
    evidence_refs,
    metadata,
    created_at,
    updated_at,
    submission_status,
    human_submitted_at
  )
  SELECT
    'db99c83e-4f35-4872-9d0e-a3a8a3bcf4f7'::uuid,
    'Facebook',
    'Platform Report',
    'https://www.facebook.com/share/v/1HrrxMRZvs/?mibextid=wwXIfr',
    'Approved',
    '2026-10-01 15:33:00+05:30'::timestamptz,
    '2026-10-01 15:33:00+05:30'::timestamptz,
    'Submitted for removal and removed immediately at 3:33 PM IST on 1 October 2026.',
    '[]'::jsonb,
    jsonb_build_object(
      'record_source', 'owner_confirmed',
      'client_id', 'ET-935050-DBB25D',
      'outcome', 'removed',
      'removed_at', '2026-10-01T15:33:00+05:30',
      'timezone', 'Asia/Kolkata'
    ),
    '2026-10-01 15:33:00+05:30'::timestamptz,
    now(),
    'submitted',
    '2026-10-01 15:33:00+05:30'::timestamptz
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.enforcement_requests
    WHERE user_id = 'db99c83e-4f35-4872-9d0e-a3a8a3bcf4f7'::uuid
      AND target_url = 'https://www.facebook.com/share/v/1HrrxMRZvs/?mibextid=wwXIfr'
  )
  RETURNING id, user_id
)
INSERT INTO public.enforcement_status_history (
  user_id,
  enforcement_request_id,
  from_status,
  to_status,
  note,
  created_at
)
SELECT
  user_id,
  id,
  'Sent',
  'Approved',
  'Platform content removed immediately following submission at 3:33 PM IST on 1 October 2026.',
  '2026-10-01 15:33:00+05:30'::timestamptz
FROM inserted;