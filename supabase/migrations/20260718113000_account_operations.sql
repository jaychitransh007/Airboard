-- Account operations, enterprise directory controls, and privacy workflow state.

alter table public.profiles
  add column if not exists default_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists preferences jsonb not null default '{"overlayEnabled":true,"neonTheme":true,"videoEnabled":true,"audioEnabled":true,"personOcclusion":true}'::jsonb,
  add column if not exists notification_preferences jsonb not null default '{"product":true,"trial":true,"security":true,"billing":true}'::jsonb,
  add column if not exists deletion_requested_at timestamptz;

alter table public.organizations
  add column if not exists deletion_requested_at timestamptz;

alter table public.data_requests
  add column if not exists execute_after timestamptz,
  add column if not exists result jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.identity_provider_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  protocol text not null default 'saml' check (protocol in ('saml', 'oidc')),
  metadata_url text,
  entity_id text,
  domains text[] not null default '{}',
  enforced boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'pending_verification', 'active', 'disabled', 'error')),
  last_error_code text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scim_access_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references public.profiles(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.directory_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_id text,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('admin', 'billing', 'member', 'viewer')),
  active boolean not null default true,
  profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email),
  unique nulls not distinct (organization_id, external_id)
);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  category text not null,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  company text,
  company_size_band text,
  use_case text,
  source text not null default 'contact_sales',
  status text not null default 'new' check (status in ('new', 'qualified', 'contacted', 'converted', 'closed')),
  ip_hash text,
  request_id text,
  created_at timestamptz not null default now()
);

create index if not exists scim_access_tokens_org_idx on public.scim_access_tokens (organization_id, status);
create index if not exists directory_users_org_idx on public.directory_users (organization_id, active);
create index if not exists data_requests_status_idx on public.data_requests (status, execute_after, requested_at);

update public.profiles profile
set default_organization_id = (
  select membership.organization_id from public.organization_memberships membership
  where membership.profile_id = profile.id and membership.status = 'active'
  order by membership.created_at asc limit 1
)
where profile.default_organization_id is null;

create or replace function public.bootstrap_airboard_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.profiles;
  organization_record public.organizations;
  workspace_record public.workspaces;
  base_slug text;
begin
  insert into public.profiles (auth_user_id, email, display_name, avatar_url, locale, timezone)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Airboard user'),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en'),
    coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC')
  )
  on conflict (auth_user_id) do update set
    email = excluded.email,
    display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now()
  returning * into profile_record;

  if not exists (select 1 from public.organization_memberships where profile_id = profile_record.id) then
    base_slug := 'personal-' || replace(new.id::text, '-', '');
    insert into public.organizations (name, slug, kind, created_by)
    values (profile_record.display_name || '''s workspace', left(base_slug, 63), 'personal', profile_record.id)
    returning * into organization_record;

    insert into public.organization_memberships (organization_id, profile_id, role, status, joined_at)
    values (organization_record.id, profile_record.id, 'owner', 'active', now());
    update public.profiles set default_organization_id = organization_record.id where id = profile_record.id;

    insert into public.workspaces (organization_id, name, is_default, created_by)
    values (organization_record.id, 'My Airboards', true, profile_record.id)
    returning * into workspace_record;
    insert into public.organization_policies (organization_id, updated_by)
    values (organization_record.id, profile_record.id);
    insert into public.trial_eligibility (profile_id, organization_id)
    values (profile_record.id, organization_record.id);
    insert into public.entitlements (user_id, organization_id, plan, status, source, feature_key, valid_until)
    values (profile_record.id, organization_record.id, 'trial_pending', 'pending', 'trial', 'airboard.presenter', now());
  end if;
  return new;
end;
$$;

alter table public.identity_provider_configs enable row level security;
alter table public.scim_access_tokens enable row level security;
alter table public.directory_users enable row level security;
alter table public.support_requests enable row level security;
alter table public.marketing_leads enable row level security;

create policy "identity_provider_read_admin" on public.identity_provider_configs for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "scim_tokens_read_admin" on public.scim_access_tokens for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "directory_users_read_admin" on public.directory_users for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "support_requests_read_self" on public.support_requests for select to authenticated
  using (profile_id = public.current_profile_id());
