-- Per-minute rate limits, counted across API instances (RGB-019). Each
-- instance still keeps its own sliding window as a first, cheap check; this
-- shared count stops the limits multiplying with the instance count. The API
-- hashes every key before it gets here, so no address or account id is
-- stored. The hourly lifecycle job deletes finished windows.
--
-- Only the API's service role reads or writes these rows.

create table if not exists public.rate_limit_windows (
  bucket text not null check (char_length(bucket) between 1 and 64),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 1 check (hits >= 1),
  primary key (bucket, key_hash, window_start)
);

create index if not exists rate_limit_windows_window_start_idx
  on public.rate_limit_windows (window_start);

alter table public.rate_limit_windows enable row level security;

-- Supabase grants table access to anon and authenticated by default; row
-- level security already hides the rows, and these roles have no use for them.
-- The API's service role counts through the function below and deletes old
-- windows in the lifecycle job.
revoke all on table public.rate_limit_windows from anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_windows to service_role;

-- Counts one request against the caller's current fixed window, in one
-- statement, so concurrent requests on different instances cannot both slip
-- under the limit. Returns false, and counts nothing, once the window is full.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_window_seconds integer,
  p_max integer
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_window_seconds < 1 or p_max < 1 then
    return false;
  end if;
  insert into public.rate_limit_windows as windows (bucket, key_hash, window_start, hits)
  values (
    p_bucket,
    p_key_hash,
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds),
    1
  )
  on conflict (bucket, key_hash, window_start) do update
    set hits = windows.hits + 1
    where windows.hits < p_max
  returning hits into v_hits;
  return v_hits is not null;
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by default; this is an API service primitive.
revoke all on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role;
