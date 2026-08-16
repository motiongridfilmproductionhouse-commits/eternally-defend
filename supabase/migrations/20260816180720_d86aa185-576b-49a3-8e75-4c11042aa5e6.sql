CREATE TABLE IF NOT EXISTS public.onboarding_completion_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, recipient)
);

GRANT SELECT, INSERT, UPDATE ON public.onboarding_completion_notifications TO authenticated;
GRANT ALL ON public.onboarding_completion_notifications TO service_role;

ALTER TABLE public.onboarding_completion_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_completion_notifications_select"
  ON public.onboarding_completion_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "own_completion_notifications_insert"
  ON public.onboarding_completion_notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own_completion_notifications_update"
  ON public.onboarding_completion_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);