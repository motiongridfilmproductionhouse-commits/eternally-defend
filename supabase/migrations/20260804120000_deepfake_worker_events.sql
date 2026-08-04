-- Durable Deepfake worker execution events for startup/execution diagnosis.
-- Console logs alone are insufficient when waitUntil work fails silently.

CREATE TABLE IF NOT EXISTS public.deepfake_worker_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.deepfake_scans(id) ON DELETE CASCADE,
  worker_execution_id text NOT NULL,
  request_id text NULL,
  event_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_category text NULL,
  error_message text NULL
);

CREATE INDEX IF NOT EXISTS deepfake_worker_events_scan_created_idx
  ON public.deepfake_worker_events (scan_id, created_at ASC);

CREATE INDEX IF NOT EXISTS deepfake_worker_events_scan_event_idx
  ON public.deepfake_worker_events (scan_id, event_name, created_at ASC);

CREATE INDEX IF NOT EXISTS deepfake_worker_events_execution_idx
  ON public.deepfake_worker_events (worker_execution_id, created_at ASC);

ALTER TABLE public.deepfake_worker_events ENABLE ROW LEVEL SECURITY;

-- Service role / server workers write events. Authenticated owners can read.
DROP POLICY IF EXISTS deepfake_worker_events_owner_select ON public.deepfake_worker_events;
CREATE POLICY deepfake_worker_events_owner_select
  ON public.deepfake_worker_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.deepfake_scans s
      WHERE s.id = deepfake_worker_events.scan_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS deepfake_worker_events_service_all ON public.deepfake_worker_events;
CREATE POLICY deepfake_worker_events_service_all
  ON public.deepfake_worker_events
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.deepfake_worker_events IS
  'Durable Deepfake worker lifecycle events (hook accept → claim → first query).';
