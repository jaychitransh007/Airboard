create table if not exists public.board_assets (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('image', 'video', 'washi_pattern', 'thumbnail', 'poster')),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 104857600),
  original_name text not null,
  storage_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists board_assets_board_created_idx
  on public.board_assets (board_id, created_at desc);
create index if not exists board_assets_pending_idx
  on public.board_assets (status, created_at)
  where status = 'pending';

alter table public.board_assets enable row level security;
create policy "board_assets_read_member" on public.board_assets for select to authenticated
  using (public.is_org_member(organization_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-assets',
  'board-assets',
  false,
  104857600,
  array[
    'image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/tiff',
    'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload/download/delete are issued by the authenticated API through signed
-- storage URLs. No direct authenticated storage.objects policy is created.
