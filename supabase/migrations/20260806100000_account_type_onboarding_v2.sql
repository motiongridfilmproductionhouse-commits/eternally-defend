-- New-account-only onboarding gate.
-- This migration does not update existing rows and has no v2 default.

alter table public.onboarding_progress
  add column if not exists onboarding_version text;

alter table public.onboarding_progress
  add constraint onboarding_progress_version_check
  check (onboarding_version is null or onboarding_version in ('v1', 'v2'));

do $$
begin
  alter type public.account_type_enum add value if not exists 'individual';
  alter type public.account_type_enum add value if not exists 'celebrity';
  alter type public.account_type_enum add value if not exists 'enterprise';
  alter type public.account_type_enum add value if not exists 'production_house';
exception when duplicate_object then null;
end $$;

create or replace function public.prevent_onboarding_version_client_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated'
    and coalesce(old.onboarding_version, 'v1') <> coalesce(new.onboarding_version, 'v1') then
    raise exception 'onboarding_version is server controlled';
  end if;
  return new;
end;
$$;

drop trigger if exists client_profiles_onboarding_version_guard on public.client_profiles;
create trigger client_profiles_onboarding_version_guard
before update on public.client_profiles
for each row execute function public.prevent_onboarding_version_client_update();

create or replace function public.prevent_onboarding_progress_version_client_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated'
    and coalesce(old.onboarding_version, 'v1') <> coalesce(new.onboarding_version, 'v1') then
    raise exception 'onboarding_version is server controlled';
  end if;
  return new;
end;
$$;

drop trigger if exists onboarding_progress_version_guard on public.onboarding_progress;
create trigger onboarding_progress_version_guard
before update on public.onboarding_progress
for each row execute function public.prevent_onboarding_progress_version_client_update();
