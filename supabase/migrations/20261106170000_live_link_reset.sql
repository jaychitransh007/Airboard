-- "New link" in Share: live links issued before this moment stop admitting new
-- people. People already in the session keep going. Null means every link the
-- session issued still works until it expires.

alter table public.board_sessions
  add column if not exists join_links_reset_at timestamptz;
