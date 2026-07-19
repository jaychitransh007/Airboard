-- Airboard commercial control plane.
--
-- This migration keeps the original pilot tables compatible while adding the
-- identity, tenant, trial, billing, installation, privacy, analytics, audit,
-- and durable standalone-board boundaries required by the customer product.

create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists locale text not null default 'en',
  add column if not exists timezone text not null default 'UTC',
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind text not null default 'personal' check (kind in ('personal', 'team', 'enterprise')),
  company_size_band text,
  country_code text,
  billing_email text,
  security_contact_email text,
  data_region text not null default 'asia-south1',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  domain text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'revoked')),
  verification_token_hash text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, domain)
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'billing', 'member', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'billing', 'member', 'viewer')),
  token_hash text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  is_default boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspaces_one_default_per_org_idx
  on public.workspaces (organization_id) where is_default;

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  title text not null default 'Untitled Airboard' check (char_length(title) between 1 and 240),
  description text,
  latest_state jsonb not null default '{}'::jsonb,
  latest_version integer not null default 0,
  visibility text not null default 'private' check (visibility in ('private', 'organization', 'link')),
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_versions (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  version integer not null,
  state jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (board_id, version)
);

create table if not exists public.board_shares (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  token_hash text not null unique,
  role text not null default 'viewer' check (role in ('editor', 'viewer')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.board_sessions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists board_id uuid references public.boards(id) on delete set null,
  add column if not exists ended_at timestamptz;

create table if not exists public.platform_installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  installed_by uuid references public.profiles(id) on delete set null,
  platform text not null check (platform in ('standalone', 'chrome_meet', 'google_workspace', 'zoom', 'teams', 'desktop')),
  external_tenant_id text,
  external_installation_id text,
  status text not null default 'pending' check (status in ('pending', 'connected', 'degraded', 'revoked')),
  version text,
  granted_scopes text[] not null default '{}',
  capabilities jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{"overlayEnabled":true,"neonTheme":true,"videoEnabled":true,"audioEnabled":true,"personOcclusion":true}'::jsonb,
  consented_at timestamptz,
  last_seen_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  token_hash text,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, platform, external_installation_id)
);

create table if not exists public.organization_policies (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  allowed_platforms text[] not null default array['standalone','chrome_meet','desktop'],
  external_guests_allowed boolean not null default true,
  voice_enabled boolean not null default true,
  camera_enabled boolean not null default true,
  gesture_enabled boolean not null default true,
  exports_enabled boolean not null default true,
  content_retention_days integer not null default 30 check (content_retention_days between 1 and 3650),
  diagnostic_retention_days integer not null default 7 check (diagnostic_retention_days between 1 and 90),
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.entitlements
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists feature_key text not null default 'airboard.presenter',
  add column if not exists starts_at timestamptz not null default now(),
  add column if not exists external_subscription_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.entitlements drop constraint if exists entitlements_status_check;
alter table public.entitlements add constraint entitlements_status_check
  check (status in ('pending', 'active', 'trialing', 'grace', 'past_due', 'expired', 'canceled'));
alter table public.entitlements drop constraint if exists entitlements_source_check;
alter table public.entitlements add constraint entitlements_source_check
  check (source in ('local_seed', 'stripe', 'manual', 'trial', 'enterprise_contract'));

create table if not exists public.trial_eligibility (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'eligible' check (status in ('eligible', 'activated', 'converted', 'expired', 'ineligible')),
  activated_at timestamptz,
  expires_at timestamptz,
  converted_at timestamptz,
  activation_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id),
  unique (organization_id)
);

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  provider text not null default 'stripe' check (provider in ('stripe', 'manual')),
  external_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  external_subscription_id text unique,
  external_price_id text,
  plan_key text not null,
  status text not null check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'incomplete', 'unpaid')),
  seat_quantity integer not null default 1 check (seat_quantity > 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  raw_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  installation_id uuid references public.platform_installations(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'privacy', 'cookies_analytics', 'camera', 'microphone', 'voice_processing', 'support_diagnostics')),
  document_version text not null,
  granted boolean not null,
  source text not null,
  user_agent_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  profile_id uuid references public.profiles(id) on delete set null,
  organization_id uuid references public.organizations(id) on delete set null,
  installation_id uuid references public.platform_installations(id) on delete set null,
  board_session_id uuid references public.board_sessions(id) on delete set null,
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_.]{1,79}$'),
  schema_version integer not null default 1,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'support', 'webhook')),
  action text not null,
  target_type text,
  target_id text,
  request_id text,
  ip_hash text,
  user_agent_summary text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table if not exists public.diagnostic_bundles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  board_session_id uuid references public.board_sessions(id) on delete set null,
  status text not null default 'ready' check (status in ('ready', 'attached', 'expired', 'deleted')),
  includes_content boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.voice_trace_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  voice_turn_id text not null,
  sequence integer not null,
  stage text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null default (now() + interval '14 days'),
  unique (organization_id, voice_turn_id, sequence)
);

create table if not exists public.data_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check (request_type in ('export', 'delete_account', 'delete_workspace')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'canceled')),
  result_path text,
  error_code text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.webhook_inbox (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, external_event_id)
);

create table if not exists public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  template_key text not null,
  recipient_email text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'canceled')),
  send_after timestamptz not null default now(),
  attempts integer not null default 0,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists organization_memberships_profile_idx on public.organization_memberships (profile_id, status);
create index if not exists boards_org_updated_idx on public.boards (organization_id, updated_at desc) where deleted_at is null;
create index if not exists product_events_org_time_idx on public.product_events (organization_id, occurred_at desc);
create index if not exists audit_events_org_time_idx on public.audit_events (organization_id, occurred_at desc);
create index if not exists platform_installations_org_platform_idx on public.platform_installations (organization_id, platform, status);
create unique index if not exists entitlements_external_subscription_idx
  on public.entitlements (external_subscription_id) where external_subscription_id is not null;
create index if not exists notification_jobs_due_idx on public.notification_jobs (status, send_after) where status = 'queued';
create index if not exists voice_trace_events_org_turn_idx on public.voice_trace_events (organization_id, voice_turn_id, sequence);
create index if not exists voice_trace_events_expiry_idx on public.voice_trace_events (expires_at);
create index if not exists webhook_inbox_status_idx on public.webhook_inbox (status, received_at);

-- Membership helpers are security-definer functions so policies do not recurse
-- through organization_memberships while evaluating that table's own rows.
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = target_org
      and profile_id = public.current_profile_id()
      and status = 'active'
  )
$$;

create or replace function public.is_org_admin(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = target_org
      and profile_id = public.current_profile_id()
      and status = 'active'
      and role in ('owner', 'admin')
  )
$$;

revoke all on function public.current_profile_id() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_admin(uuid) from public;
grant execute on function public.current_profile_id() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;

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

drop trigger if exists on_auth_user_created_airboard on auth.users;
create trigger on_auth_user_created_airboard
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute procedure public.bootstrap_airboard_user();

-- Backfill personal organizations for profiles created by the pilot seed.
do $$
declare
  profile_record public.profiles;
  created_organization_id uuid;
begin
  for profile_record in
    select p.* from public.profiles p
    where not exists (
      select 1 from public.organization_memberships membership where membership.profile_id = p.id
    )
  loop
    insert into public.organizations (name, slug, kind, created_by)
    values (
      profile_record.display_name || '''s workspace',
      left('personal-' || replace(profile_record.id::text, '-', ''), 63),
      'personal',
      profile_record.id
    ) returning id into created_organization_id;
    insert into public.organization_memberships (organization_id, profile_id, role, status, joined_at)
    values (created_organization_id, profile_record.id, 'owner', 'active', now());
    insert into public.workspaces (organization_id, name, is_default, created_by)
    values (created_organization_id, 'My Airboards', true, profile_record.id);
    insert into public.organization_policies (organization_id, updated_by)
    values (created_organization_id, profile_record.id);
    insert into public.trial_eligibility (profile_id, organization_id)
    values (profile_record.id, created_organization_id)
    on conflict do nothing;
    update public.entitlements
      set organization_id = created_organization_id
      where user_id = profile_record.id and public.entitlements.organization_id is null;
    update public.board_sessions
      set organization_id = created_organization_id
      where owner_user_id = profile_record.id and public.board_sessions.organization_id is null;
  end loop;
end $$;

-- The service role performs mutations through the API. Authenticated clients
-- receive narrowly scoped read policies for app rendering; they never write
-- tenant, entitlement, billing, audit, or event records directly.
alter table public.profiles enable row level security;
alter table public.entitlements enable row level security;
alter table public.board_sessions enable row level security;
alter table public.participants enable row level security;
alter table public.board_events enable row level security;
alter table public.board_snapshots enable row level security;
alter table public.exports enable row level security;
alter table public.analytics_events enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_domains enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.workspaces enable row level security;
alter table public.boards enable row level security;
alter table public.board_versions enable row level security;
alter table public.board_shares enable row level security;
alter table public.platform_installations enable row level security;
alter table public.organization_policies enable row level security;
alter table public.trial_eligibility enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.consent_records enable row level security;
alter table public.product_events enable row level security;
alter table public.audit_events enable row level security;
alter table public.diagnostic_bundles enable row level security;
alter table public.voice_trace_events enable row level security;
alter table public.data_requests enable row level security;
alter table public.webhook_inbox enable row level security;
alter table public.notification_jobs enable row level security;

create policy "profiles_read_self" on public.profiles for select to authenticated
  using (auth_user_id = auth.uid());
create policy "organizations_read_member" on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy "memberships_read_member" on public.organization_memberships for select to authenticated
  using (public.is_org_member(organization_id));
create policy "domains_read_admin" on public.organization_domains for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "invitations_read_admin" on public.organization_invitations for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "workspaces_read_member" on public.workspaces for select to authenticated
  using (public.is_org_member(organization_id));
create policy "boards_read_member" on public.boards for select to authenticated
  using (public.is_org_member(organization_id));
create policy "board_versions_read_member" on public.board_versions for select to authenticated
  using (exists (select 1 from public.boards b where b.id = board_id and public.is_org_member(b.organization_id)));
create policy "board_shares_read_admin" on public.board_shares for select to authenticated
  using (exists (select 1 from public.boards b where b.id = board_id and public.is_org_admin(b.organization_id)));
create policy "sessions_read_member" on public.board_sessions for select to authenticated
  using (organization_id is not null and public.is_org_member(organization_id));
create policy "participants_read_session_member" on public.participants for select to authenticated
  using (exists (select 1 from public.board_sessions s where s.id = board_session_id and public.is_org_member(s.organization_id)));
create policy "board_events_read_session_member" on public.board_events for select to authenticated
  using (exists (select 1 from public.board_sessions s where s.id = board_session_id and public.is_org_member(s.organization_id)));
create policy "snapshots_read_session_member" on public.board_snapshots for select to authenticated
  using (exists (select 1 from public.board_sessions s where s.id = board_session_id and public.is_org_member(s.organization_id)));
create policy "exports_read_session_member" on public.exports for select to authenticated
  using (exists (select 1 from public.board_sessions s where s.id = board_session_id and public.is_org_member(s.organization_id)));
create policy "entitlements_read_self_or_admin" on public.entitlements for select to authenticated
  using (user_id = public.current_profile_id() or (organization_id is not null and public.is_org_admin(organization_id)));
create policy "installations_read_member" on public.platform_installations for select to authenticated
  using (public.is_org_member(organization_id));
create policy "policies_read_member" on public.organization_policies for select to authenticated
  using (public.is_org_member(organization_id));
create policy "trial_read_self" on public.trial_eligibility for select to authenticated
  using (profile_id = public.current_profile_id());
create policy "billing_customer_read_admin" on public.billing_customers for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "billing_subscription_read_admin" on public.billing_subscriptions for select to authenticated
  using (public.is_org_admin(organization_id));
create policy "consent_read_self" on public.consent_records for select to authenticated
  using (profile_id = public.current_profile_id());
create policy "audit_read_admin" on public.audit_events for select to authenticated
  using (organization_id is not null and public.is_org_admin(organization_id));
create policy "diagnostics_read_self" on public.diagnostic_bundles for select to authenticated
  using (profile_id = public.current_profile_id());
create policy "data_requests_read_self" on public.data_requests for select to authenticated
  using (profile_id = public.current_profile_id());

-- No authenticated policies are intentionally defined for product_events,
-- analytics_events, webhook_inbox, or notification_jobs. These are API-only.
