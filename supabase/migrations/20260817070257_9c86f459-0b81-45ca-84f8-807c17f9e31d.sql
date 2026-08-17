UPDATE public.signup_invites
SET expires_at = now() + interval '14 days',
    account_type = CASE WHEN lower(coalesce(account_type,'')) IN ('bussiness','business') THEN 'business' ELSE account_type END
WHERE id = '00b9506d-be55-4c26-bfea-7251692b942f';