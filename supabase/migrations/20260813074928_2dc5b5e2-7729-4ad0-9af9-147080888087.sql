CREATE TABLE public.face_enrollment_handoffs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX face_enrollment_handoffs_user_idx ON public.face_enrollment_handoffs (user_id, created_at DESC);

GRANT SELECT ON public.face_enrollment_handoffs TO authenticated;
GRANT ALL ON public.face_enrollment_handoffs TO service_role;

ALTER TABLE public.face_enrollment_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own face enrollment handoffs"
ON public.face_enrollment_handoffs FOR SELECT TO authenticated
USING (auth.uid() = user_id);