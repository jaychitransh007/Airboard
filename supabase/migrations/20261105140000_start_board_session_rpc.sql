-- Starts a live board session and its owner participant in one round trip.
-- The API made these two inserts one after the other; one function keeps
-- them in a single transaction (no session is left without its owner) and
-- saves a database round trip on every board open.
--
-- Access checks (entitlement, board and workspace) stay in the API, which
-- calls this with the service role only.

create or replace function public.start_board_session(
  p_owner_user_id uuid,
  p_provider text,
  p_allow_participant_drawing boolean,
  p_owner_display_name text,
  p_organization_id uuid default null,
  p_workspace_id uuid default null,
  p_board_id uuid default null,
  p_provider_meeting_id text default null,
  p_title text default null
)
returns table (session jsonb, participant jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_session public.board_sessions;
  v_participant public.participants;
begin
  insert into public.board_sessions (
    owner_user_id,
    provider,
    status,
    allow_participant_drawing,
    owner_last_seen_at,
    expires_at,
    organization_id,
    workspace_id,
    board_id,
    provider_meeting_id,
    title
  ) values (
    p_owner_user_id,
    p_provider,
    'active',
    p_allow_participant_drawing,
    v_now,
    v_now + interval '6 hours',
    p_organization_id,
    p_workspace_id,
    p_board_id,
    p_provider_meeting_id,
    coalesce(nullif(p_title, ''), 'Airboard')
  )
  returning * into v_session;

  insert into public.participants (board_session_id, user_id, display_name, role, input_enabled)
  values (v_session.id, p_owner_user_id, coalesce(nullif(p_owner_display_name, ''), 'Owner'), 'owner', true)
  returning * into v_participant;

  return query select to_jsonb(v_session), to_jsonb(v_participant);
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by default; this is an API service primitive.
revoke all on function public.start_board_session(
  uuid, text, boolean, text, uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.start_board_session(
  uuid, text, boolean, text, uuid, uuid, uuid, text, text
) to service_role;
