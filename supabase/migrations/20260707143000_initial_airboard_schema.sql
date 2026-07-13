create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  local_user_key text unique,
  email text,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null,
  status text not null check (status in ('active', 'trialing', 'expired', 'canceled')),
  source text not null check (source in ('local_seed', 'stripe', 'manual')),
  valid_until timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.board_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null check (provider in ('standalone', 'google_meet', 'zoom', 'teams', 'chrome_overlay')),
  provider_meeting_id text,
  title text,
  status text not null check (status in ('active', 'owner_disconnected', 'locked', 'ended')),
  allow_participant_drawing boolean not null default true,
  owner_last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  board_session_id uuid not null references public.board_sessions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  guest_id text,
  display_name text not null,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  input_enabled boolean not null default true,
  connected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.board_events (
  id uuid primary key default gen_random_uuid(),
  board_session_id uuid not null references public.board_sessions(id) on delete cascade,
  sequence bigint not null,
  actor_participant_id uuid references public.participants(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (board_session_id, sequence)
);

create table if not exists public.board_snapshots (
  id uuid primary key default gen_random_uuid(),
  board_session_id uuid not null references public.board_sessions(id) on delete cascade,
  last_sequence bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  board_session_id uuid not null references public.board_sessions(id) on delete cascade,
  requested_by_participant_id uuid references public.participants(id) on delete set null,
  storage_path text not null,
  format text not null check (format in ('png', 'pdf')),
  created_at timestamptz not null default now()
);

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  board_session_id uuid references public.board_sessions(id) on delete set null,
  participant_id uuid references public.participants(id) on delete set null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists entitlements_user_status_idx
  on public.entitlements (user_id, status, valid_until desc);

create index if not exists board_sessions_owner_status_idx
  on public.board_sessions (owner_user_id, status, created_at desc);

create index if not exists participants_session_idx
  on public.participants (board_session_id, role);

create index if not exists board_events_session_sequence_idx
  on public.board_events (board_session_id, sequence);

create index if not exists board_events_session_created_idx
  on public.board_events (board_session_id, created_at);
