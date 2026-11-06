-- Daily allowances for the paid providers behind Airo (OpenAI) and voice
-- (Deepgram), counted per person and per UTC day. Per-minute rate limits live
-- in each API instance and multiply with the instance count; these totals live
-- here so the allowance holds across instances (threat model X-1).
--
-- Only the API's service role reads or writes these rows.

create table if not exists public.daily_usage (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null,
  metric text not null check (metric in ('airo_commands', 'voice_seconds')),
  amount bigint not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (profile_id, usage_date, metric)
);

alter table public.daily_usage enable row level security;

-- Adds p_amount to today's total when the result stays within p_limit, in one
-- statement, so concurrent requests on different instances cannot both slip
-- under the limit. Returns the new total, or null when the allowance is used up.
create or replace function public.consume_daily_usage(
  p_profile_id uuid,
  p_metric text,
  p_amount bigint,
  p_limit bigint
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total bigint;
begin
  if p_amount < 0 or p_amount > p_limit then
    return null;
  end if;
  insert into public.daily_usage as usage (profile_id, usage_date, metric, amount)
  values (p_profile_id, (now() at time zone 'utc')::date, p_metric, p_amount)
  on conflict (profile_id, usage_date, metric) do update
    set amount = usage.amount + excluded.amount,
        updated_at = now()
    where usage.amount + excluded.amount <= p_limit
  returning amount into v_total;
  return v_total;
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by default; this is an API service primitive.
revoke all on function public.consume_daily_usage(uuid, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.consume_daily_usage(uuid, text, bigint, bigint)
  to service_role;
