-- Private boards are their owner's alone. Boards default to 'private', but every
-- read policy below only checked organization membership, so any member could
-- read every board, its history, its live session events and its files.
-- Organization and link boards stay readable by the organization's members.

create or replace function public.can_read_board(target_board uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.boards b
    where b.id = target_board
      and public.is_org_member(b.organization_id)
      and (b.visibility <> 'private' or b.owner_profile_id = public.current_profile_id())
  )
$$;

create or replace function public.can_read_board_session(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_sessions s
    where s.id = target_session
      and s.organization_id is not null
      and public.is_org_member(s.organization_id)
      and (s.board_id is null or public.can_read_board(s.board_id))
  )
$$;

revoke all on function public.can_read_board(uuid) from public;
revoke all on function public.can_read_board_session(uuid) from public;
grant execute on function public.can_read_board(uuid) to authenticated;
grant execute on function public.can_read_board_session(uuid) to authenticated;

drop policy if exists "boards_read_member" on public.boards;
create policy "boards_read_member" on public.boards for select to authenticated
  using (
    public.is_org_member(organization_id)
    and (visibility <> 'private' or owner_profile_id = public.current_profile_id())
  );

drop policy if exists "board_versions_read_member" on public.board_versions;
create policy "board_versions_read_member" on public.board_versions for select to authenticated
  using (public.can_read_board(board_id));

drop policy if exists "sessions_read_member" on public.board_sessions;
create policy "sessions_read_member" on public.board_sessions for select to authenticated
  using (
    organization_id is not null
    and public.is_org_member(organization_id)
    and (board_id is null or public.can_read_board(board_id))
  );

drop policy if exists "participants_read_session_member" on public.participants;
create policy "participants_read_session_member" on public.participants for select to authenticated
  using (public.can_read_board_session(board_session_id));

drop policy if exists "board_events_read_session_member" on public.board_events;
create policy "board_events_read_session_member" on public.board_events for select to authenticated
  using (public.can_read_board_session(board_session_id));

drop policy if exists "snapshots_read_session_member" on public.board_snapshots;
create policy "snapshots_read_session_member" on public.board_snapshots for select to authenticated
  using (public.can_read_board_session(board_session_id));

drop policy if exists "exports_read_session_member" on public.exports;
create policy "exports_read_session_member" on public.exports for select to authenticated
  using (public.can_read_board_session(board_session_id));

drop policy if exists "board_assets_read_member" on public.board_assets;
create policy "board_assets_read_member" on public.board_assets for select to authenticated
  using (public.is_org_member(organization_id) and public.can_read_board(board_id));
