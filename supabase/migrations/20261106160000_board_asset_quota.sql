-- Per-organization storage quota for board images and video (threat model
-- A-6). Before signing an upload the API adds up what the organization already
-- holds: ready assets at their stored size, pending uploads at their declared
-- size (so concurrent starts cannot reserve past the limit). Failed rows hold
-- no object and do not count.
--
-- Only the API's service role calls this.

create or replace function public.organization_board_asset_bytes(p_organization_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(byte_size), 0)::bigint
  from public.board_assets
  where organization_id = p_organization_id
    and status in ('pending', 'ready');
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by default; this is an API service primitive.
revoke all on function public.organization_board_asset_bytes(uuid)
  from public, anon, authenticated;
grant execute on function public.organization_board_asset_bytes(uuid)
  to service_role;

-- Serves the sum above from the index alone.
create index if not exists board_assets_org_bytes_idx
  on public.board_assets (organization_id) include (byte_size)
  where status in ('pending', 'ready');

-- The hourly lifecycle job sweeps stale pending and failed uploads across all
-- organizations, oldest first; board_assets_stale_cleanup_idx leads with
-- organization_id and only serves the per-organization sweep.
create index if not exists board_assets_stale_sweep_idx
  on public.board_assets (updated_at, id)
  where status in ('pending', 'failed');
