-- Live-session history (participants' names and every board event) follows
-- the board it belongs to. A session without a board (none was named when it
-- started) was readable by every member of the organization; it is now its
-- owner's alone. Purging a board left its sessions behind with board_id set to
-- null, which made them board-less and readable by everyone; purging a board
-- now deletes its sessions, and with them their participants and events.

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
      and case
        when s.board_id is null then s.owner_user_id = public.current_profile_id()
        else public.can_read_board(s.board_id)
      end
  )
$$;

revoke all on function public.can_read_board_session(uuid) from public;
grant execute on function public.can_read_board_session(uuid) to authenticated;

drop policy if exists "sessions_read_member" on public.board_sessions;
create policy "sessions_read_member" on public.board_sessions for select to authenticated
  using (
    organization_id is not null
    and public.is_org_member(organization_id)
    and case
      when board_id is null then owner_user_id = public.current_profile_id()
      else public.can_read_board(board_id)
    end
  );

-- participants, board_events, board_snapshots and exports already read
-- through can_read_board_session, so the new rule reaches them unchanged.

alter table public.board_sessions drop constraint if exists board_sessions_board_id_fkey;
alter table public.board_sessions
  add constraint board_sessions_board_id_fkey
  foreign key (board_id) references public.boards(id) on delete cascade;
