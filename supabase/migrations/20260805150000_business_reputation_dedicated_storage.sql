-- Dedicated, owner-scoped persistence for Business Reputation findings.
-- scan_hits remains a compatibility mirror; these tables are the Business source of truth.

create table if not exists public.business_reputation_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  places_place_id text not null,
  selected_name text not null,
  normalized_domain text,
  scope text not null default 'brand' check (scope in ('branch', 'brand')),
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, places_place_id),
  unique (id, user_id)
);

alter table public.scans add column if not exists business_profile_id uuid;
create index if not exists business_reputation_profiles_user_idx
  on public.business_reputation_profiles(user_id, updated_at desc);

create table if not exists public.business_reputation_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_profile_id uuid not null,
  scan_id uuid not null references public.scans(id) on delete cascade,
  finding_key text not null,
  source text not null,
  external_id text,
  canonical_url text not null,
  permalink text,
  title text,
  description text,
  author text,
  thumbnail_url text,
  published_at timestamptz,
  engagement bigint,
  threat_score numeric,
  severity text,
  risk_type text,
  tags text[] not null default '{}',
  metrics jsonb not null default '{}'::jsonb,
  state text not null default 'new' check (state in ('new', 'active', 'removed', 'changed', 'reappeared')),
  first_detected_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  removed_at timestamptz,
  first_scan_id uuid not null references public.scans(id),
  last_seen_scan_id uuid not null references public.scans(id),
  times_detected integer not null default 1,
  unique (user_id, business_profile_id, finding_key),
  unique (id, user_id)
);

create index if not exists business_reputation_findings_scan_idx
  on public.business_reputation_findings(user_id, scan_id, last_checked_at desc);
create index if not exists business_reputation_findings_profile_idx
  on public.business_reputation_findings(user_id, business_profile_id, state);

create table if not exists public.business_reputation_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  finding_id uuid not null,
  business_profile_id uuid not null,
  scan_id uuid not null references public.scans(id) on delete cascade,
  kind text not null,
  source_url text,
  storage_bucket text,
  storage_key text,
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  unique (finding_id, scan_id, kind, content_hash),
  foreign key (finding_id, user_id) references public.business_reputation_findings(id, user_id) on delete cascade
);

create table if not exists public.business_reputation_finding_statements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  finding_id uuid not null,
  business_profile_id uuid not null,
  scan_id uuid not null references public.scans(id) on delete cascade,
  statement_type text not null,
  statement text not null,
  confidence numeric,
  explanation text,
  created_at timestamptz not null default now(),
  unique (finding_id, scan_id, statement_type, statement),
  foreign key (finding_id, user_id) references public.business_reputation_findings(id, user_id) on delete cascade
);

create table if not exists public.business_reputation_reporting_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  finding_id uuid not null,
  business_profile_id uuid not null,
  scan_id uuid not null references public.scans(id) on delete cascade,
  route_type text not null,
  applies_reason text not null,
  required_evidence jsonb not null default '[]'::jsonb,
  missing_evidence jsonb not null default '[]'::jsonb,
  recipient text,
  reporting_url text,
  draft_body text not null,
  human_approval_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (finding_id, scan_id, route_type),
  foreign key (finding_id, user_id) references public.business_reputation_findings(id, user_id) on delete cascade
);

create table if not exists public.business_reputation_infrastructure_details (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  finding_id uuid not null,
  business_profile_id uuid not null,
  scan_id uuid not null references public.scans(id) on delete cascade,
  domain text not null,
  status text not null default 'partial' check (status in ('complete', 'partial', 'unavailable')),
  registrar text,
  rdap_url text,
  whois_data jsonb,
  hosting_provider text,
  hosting_abuse_email text,
  registrar_abuse_email text,
  asn text,
  ip_addresses text[] not null default '{}',
  dns_provider text,
  nameservers text[] not null default '{}',
  cdn text,
  country text,
  website_contact_page text,
  platform_reporting_url text,
  unavailable_fields jsonb not null default '{}'::jsonb,
  resolved_at timestamptz not null default now(),
  unique (finding_id, scan_id),
  foreign key (finding_id, user_id) references public.business_reputation_findings(id, user_id) on delete cascade
);

create or replace function public.validate_business_reputation_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  profile_owner uuid;
  scan_owner uuid;
  scan_profile uuid;
  scan_type_value text;
begin
  select user_id into profile_owner from public.business_reputation_profiles
    where id = new.business_profile_id;
  select user_id, scan_type, business_profile_id into scan_owner, scan_type_value, scan_profile from public.scans
    where id = new.scan_id;
  if profile_owner is null or profile_owner <> new.user_id
    or scan_owner is null or scan_owner <> new.user_id
    or scan_profile <> new.business_profile_id
    or scan_type_value <> 'business_reputation' then
    raise exception 'Business Reputation ownership validation failed';
  end if;
  return new;
end;
$$;

drop trigger if exists business_reputation_findings_ownership on public.business_reputation_findings;
create trigger business_reputation_findings_ownership
before insert or update on public.business_reputation_findings
for each row execute function public.validate_business_reputation_ownership();

create or replace function public.validate_business_reputation_child_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  finding_owner uuid;
  finding_profile uuid;
  scan_owner uuid;
begin
  select user_id, business_profile_id into finding_owner, finding_profile
    from public.business_reputation_findings where id = new.finding_id;
  select user_id into scan_owner from public.scans
    where id = new.scan_id and scan_type = 'business_reputation';
  if finding_owner is null or finding_owner <> new.user_id
    or finding_profile <> new.business_profile_id
    or scan_owner is null or scan_owner <> new.user_id then
    raise exception 'Business Reputation finding ownership validation failed';
  end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_reputation_finding_evidence',
    'business_reputation_finding_statements',
    'business_reputation_reporting_routes',
    'business_reputation_infrastructure_details'
  ] loop
    execute format('drop trigger if exists %I_ownership on public.%I', table_name, table_name);
    execute format('create trigger %I_ownership before insert or update on public.%I for each row execute function public.validate_business_reputation_child_ownership()', table_name, table_name);
  end loop;
end $$;

alter table public.business_reputation_profiles enable row level security;
alter table public.business_reputation_findings enable row level security;
alter table public.business_reputation_finding_evidence enable row level security;
alter table public.business_reputation_finding_statements enable row level security;
alter table public.business_reputation_reporting_routes enable row level security;
alter table public.business_reputation_infrastructure_details enable row level security;

create policy business_reputation_profiles_owner_select on public.business_reputation_profiles
  for select to authenticated using (user_id = auth.uid());
create policy business_reputation_findings_owner_select on public.business_reputation_findings
  for select to authenticated using (user_id = auth.uid());
create policy business_reputation_evidence_owner_select on public.business_reputation_finding_evidence
  for select to authenticated using (user_id = auth.uid());
create policy business_reputation_statements_owner_select on public.business_reputation_finding_statements
  for select to authenticated using (user_id = auth.uid());
create policy business_reputation_routes_owner_select on public.business_reputation_reporting_routes
  for select to authenticated using (user_id = auth.uid());
create policy business_reputation_infrastructure_owner_select on public.business_reputation_infrastructure_details
  for select to authenticated using (user_id = auth.uid());

grant select on public.business_reputation_profiles, public.business_reputation_findings,
  public.business_reputation_finding_evidence, public.business_reputation_finding_statements,
  public.business_reputation_reporting_routes, public.business_reputation_infrastructure_details to authenticated;
grant all on public.business_reputation_profiles, public.business_reputation_findings,
  public.business_reputation_finding_evidence, public.business_reputation_finding_statements,
  public.business_reputation_reporting_routes, public.business_reputation_infrastructure_details to service_role;
