# Eterna Partner Portal

Premium white-themed partner program built on the existing Eterna stack (Supabase, TanStack Start server functions, S3 for document storage, pdf-lib + Unicode font stack for agreements). No mocks — everything wired to real tables and real PDF generation.

## 1. Database (single migration)

New tables (all with `authenticated` + `service_role` GRANTs, RLS on):

- **partner_applications** — one row per submission. Fields: user_id, status (`PENDING_REVIEW`|`APPROVED`|`REJECTED`|`INFO_REQUESTED`), legal_company_name, trading_name, registration_number, country, address, website, industry, founder_name, rep_name, rep_title, business_email, phone, whatsapp, territory, expected_monthly_clients, partnership_type, trade_licence_s3_key, id_document_s3_key, signature_text, signature_hash, signed_at, ip, ua, declarations jsonb, review_notes, reviewed_by, reviewed_at, partner_id (assigned on approval, e.g. `EP-2026-XXXX`).
- **partner_agreements** — status (`DRAFT_AWAITING_ETERNA`|`ETERNA_SIGNED`|`ACTIVE`|`TERMINATED`), version, s3_key (draft), signed_s3_key, sha256, generated_at, eterna_signer_id, eterna_signed_at.
- **partner_profiles** — activated partners. partner_id (unique), user_id, referral_code (unique), territory, commission_pct (default 25), status (`ACTIVE`|`SUSPENDED`), activated_at.
- **partner_referred_clients** — referral_code, partner_id, client_user_id (nullable until claimed), lead_email, lead_name, status (`LEAD`|`ONBOARDING`|`ACTIVE`|`PAID`|`REFUNDED`|`REJECTED`), sale_amount_inr, commission_amount_inr, cleared_at, notes. Unique(partner_id, client_user_id) prevents duplicate claims.
- **partner_commissions** — referred_client_id, partner_id, gross_inr (500000), commission_inr (125000), status (`PENDING`|`PAYABLE`|`PAID`|`VOID`), earned_at, paid_at, payout_ref.
- **partner_audit_log** — actor_id, partner_id, action, payload, ip, ua.

New storage bucket **partner-documents** (private) for licence, ID, agreement PDFs, signed uploads. RLS: owner user_id or admin.

`app_role` already exists — reuse `admin` for reviewers. Add helper `has_partner(_user_id)` = exists in partner_profiles ACTIVE.

## 2. Server functions (`src/lib/partners/*.functions.ts`)

Public:
- `submitPartnerApplication` — validates zod schema, computes signature_hash, inserts application (PENDING_REVIEW), generates draft agreement PDF via pdf-lib + Unicode fonts (embeds Eterna Sentinel Defence LLC address, commission table, applicant details), uploads to S3, inserts `partner_agreements` (DRAFT_AWAITING_ETERNA). Idempotent per user.
- `getMyPartnerApplication` — for logged-in user.
- `getPartnerAgreementUrl` — signed S3 GET.

Partner (requires ACTIVE partner_profile):
- `getPartnerDashboardStats` — pipeline counts, commission totals by status.
- `registerReferredClient` — creates `partner_referred_clients` LEAD.
- `getReferralLink` — returns `${PUBLIC_APP_URL}/auth?ref=<code>`.
- `listPartnerClients`, `listPartnerCommissions`, `listPartnerAgreements`.
- `generateProposalPdf` — ₹5,00,000 proposal PDF for a lead.

Admin (`has_role admin`):
- `listPartnerApplications` (filter by status).
- `getPartnerApplicationDetail`.
- `decidePartnerApplication({ id, decision, notes, territory?, commission_pct? })` — on `approve`: assign `partner_id`, create `partner_profiles` row with unique `referral_code`, upsert `user_roles` (new role `partner`), regenerate agreement with Eterna signatory block, mark agreement `ETERNA_SIGNED` + `ACTIVE`, write audit log. On `reject`/`info_requested`: update status, notes.
- `markCommissionPaid`.

Commission trigger: when a `partner_referred_clients` row moves to `PAID` (cleared payment), insert one `partner_commissions` row (gross 500000, commission 125000). Duplicate guarded by unique(referred_client_id).

## 3. Routes

Public:
- `src/routes/auth.tsx` — add third card **Become a Partner** alongside Client / Partner login. Captures optional `?ref=<code>` and stores on new client_profiles as `referred_by`.
- `src/routes/partner-apply.tsx` — multi-section form (Company, Representative, Contact, Territory, Documents, Declarations & Signature). Uses S3 signed upload for trade licence + ID. On submit calls `submitPartnerApplication`, shows success screen with agreement download.
- `src/routes/partner-status.tsx` — logged-in view: current application status, draft agreement download.

Partner (gated by `partner` role, layout `_partner/route.tsx` with beforeLoad that checks `partner_profiles` ACTIVE, redirects to `/partner-status` otherwise):
- `_partner.dashboard.tsx` — stats, referral link, register-client CTA.
- `_partner.clients.tsx` — pipeline table.
- `_partner.proposals.tsx` — generate ₹5L proposals.
- `_partner.agreements.tsx` — download active agreement.
- `_partner.commissions.tsx` — payable + paid table.
- `_partner.payments.tsx` — payout history.
- `_partner.marketing.tsx` — static downloadable assets list.

Admin:
- `_app.admin.partners.tsx` — list + detail drawer with approve/reject/info/set territory + commission %.

## 4. Agreement PDF

Uses `@/lib/pdf/unicode-fonts.server` (existing). Template:

```
ETERNA PARTNER AGREEMENT (MOU)
Between: Eterna Sentinel Defence LLC
         Meydan Grandstand, 6th Floor, Al Meydan Road,
         Nad Al Sheba, Nadd Al Shiba First, Dubai, UAE
And:     {legal_company_name} ({trading_name})
         {address}, {country}

Commission Structure
  Eterna service price per client:  ₹5,00,000
  Partner commission rate:          25%
  Partner earning per sale:         ₹1,25,000
  Eterna gross balance:             ₹3,75,000

Payment: commission payable only after Eterna receives client's
cleared payment. Taxes, discounts, refunds, cancellations and
chargebacks excluded. Every client tracked via partner_id / referral
link; duplicate claims are rejected.

Declarations, Territory, Signatures, Effective date.
```

Draft has applicant signature only; approved version adds Eterna signatory block + partner_id.

## 5. Design system

White base, `#0A0A0A` primary text, `#E5E7EB` borders, subtle `shadow-sm`, single Eterna blue accent `hsl(214 100% 48%)` for CTAs/badges. Existing shadcn tokens reused; new `.partner-*` utility classes only if needed. Fully responsive (mobile stacks form sections, dashboard tables become cards).

## 6. Anti-abuse & audit

- Every state change writes `partner_audit_log` (actor, action, payload, ip, ua).
- Duplicate claim: unique(partner_id, client_user_id) + unique(referral_code, lead_email while LEAD).
- Referral capture at signup writes `client_profiles.referred_by` (new column).
- Admin actions require `has_role(admin)`; partner actions require ACTIVE profile.

## Technical section

Files added:
- migration (tables, GRANTs, RLS, bucket, `referred_by` column on client_profiles, `partner` enum value on app_role).
- `src/lib/partners/{applications,agreements,partner,admin,commissions}.functions.ts`
- `src/lib/partners/agreement-pdf.server.ts`
- `src/routes/auth.tsx` (edit — add third CTA + ref capture)
- `src/routes/partner-apply.tsx`, `partner-status.tsx`
- `src/routes/_partner/route.tsx` + 7 child routes
- `src/routes/_app.admin.partners.tsx`
- Sidebar entry for admin.

Reuses: pdf-lib Unicode stack, S3 helpers (`putObject`, `getSignedGetUrl`), `requireSupabaseAuth`, existing shadcn UI.

No mock data. No hardcoded partners. No auto-approvals.
