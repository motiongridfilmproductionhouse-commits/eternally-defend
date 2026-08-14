CREATE OR REPLACE VIEW public.enforcement_delivery_status
WITH (security_invoker = true) AS
WITH latest_event AS (
  SELECT DISTINCT ON (d.id)
    d.id AS delivery_id,
    e.normalized_type,
    e.event_type,
    e.reason,
    e.occurred_at
  FROM public.enforcement_email_deliveries d
  JOIN public.enforcement_provider_events e
    ON e.delivery_id = d.id
    OR (e.delivery_id IS NULL
        AND e.provider_message_id IS NOT NULL
        AND e.provider_message_id = d.provider_message_id)
  ORDER BY d.id, e.occurred_at DESC, e.created_at DESC
)
SELECT
  d.id,
  d.user_id,
  d.enforcement_request_id,
  d.case_id,
  d.provider,
  d.from_email,
  d.intended_recipient,
  d.destination_email,
  d.subject,
  d.provider_message_id,
  d.delivery_status AS recorded_status,
  d.test_mode,
  d.error,
  d.sent_at,
  d.created_at,
  le.normalized_type AS latest_event_type,
  le.event_type AS latest_provider_event,
  le.reason AS latest_event_reason,
  le.occurred_at AS latest_event_at,
  CASE
    WHEN le.normalized_type IN ('HARD_BOUNCE', 'PERMANENT_BOUNCE') THEN 'HARD_BOUNCE'
    WHEN le.normalized_type IN ('SOFT_BOUNCE', 'TRANSIENT_BOUNCE') THEN 'SOFT_BOUNCE'
    WHEN le.normalized_type IN ('COMPLAINT', 'SPAM_COMPLAINT') THEN 'COMPLAINT'
    WHEN le.normalized_type = 'DELIVERED' THEN 'DELIVERED'
    WHEN le.normalized_type IN ('FAILED', 'REJECTED') THEN 'FAILED'
    WHEN upper(d.delivery_status) IN ('FAILED', 'ERROR', 'REJECTED') THEN 'FAILED'
    WHEN upper(d.delivery_status) = 'SUPPRESSED' THEN 'SUPPRESSED'
    WHEN upper(d.delivery_status) IN ('SENT', 'ACCEPTED') THEN 'SENT'
    WHEN upper(d.delivery_status) = 'PENDING' THEN 'PENDING'
    ELSE upper(d.delivery_status)
  END AS effective_status
FROM public.enforcement_email_deliveries d
LEFT JOIN latest_event le ON le.delivery_id = d.id;

GRANT SELECT ON public.enforcement_delivery_status TO authenticated;
GRANT SELECT ON public.enforcement_delivery_status TO service_role;