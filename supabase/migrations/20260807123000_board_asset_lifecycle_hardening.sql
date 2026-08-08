-- Supports the API's bounded cleanup sweep for abandoned signed uploads and
-- failed normalization attempts. Binary objects are deleted first; rows are
-- removed only after storage confirms deletion.
create index if not exists board_assets_stale_cleanup_idx
  on public.board_assets (organization_id, updated_at, id)
  where status in ('pending', 'failed');
