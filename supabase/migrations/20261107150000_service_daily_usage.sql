-- Daily totals for the whole service, across every person: a fixed ceiling on
-- what Airo (OpenAI) and voice (Deepgram) can spend in a UTC day, however many
-- accounts sign up. Each person's own allowance (daily_usage) stops one account
-- running up the bill; this stops many accounts doing it together (threat
-- model X-1). Two rows a day, kept as a spend history.
--
-- Only the API's service role reads or writes these rows.

create table if not exists public.service_daily_usage (
  usage_date date not null,
  metric text not null check (metric in ('airo_commands', 'voice_seconds')),
  amount bigint not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_date, metric)
);

alter table public.service_daily_usage enable row level security;

-- Supabase grants table access to anon and authenticated by default; row
-- level security already hides the rows, and these roles have no use for them.
revoke all on table public.service_daily_usage from anon, authenticated;
grant select, insert, update, delete on table public.service_daily_usage to service_role;

-- Charges p_amount to the person's allowance and to the service's total for
-- today, both or neither, in one transaction, so concurrent requests on
-- different instances cannot slip under either limit. Returns 'allowed',
-- 'exhausted' (the person's allowance is used up, and the service total is
-- left alone) or 'service_exhausted' (the service total is used up, and the
-- person's charge is given back).
create or replace function public.consume_daily_usage_with_service_limit(
  p_profile_id uuid,
  p_metric text,
  p_amount bigint,
  p_limit bigint,
  p_service_limit bigint
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_total bigint;
begin
  if p_amount < 0 or p_amount > p_service_limit then
    return 'service_exhausted';
  end if;
  if public.consume_daily_usage(p_profile_id, p_metric, p_amount, p_limit) is null then
    return 'exhausted';
  end if;
  insert into public.service_daily_usage as usage (usage_date, metric, amount)
  values (v_today, p_metric, p_amount)
  on conflict (usage_date, metric) do update
    set amount = usage.amount + excluded.amount,
        updated_at = now()
    where usage.amount + excluded.amount <= p_service_limit
  returning amount into v_total;
  if v_total is null then
    update public.daily_usage
      set amount = amount - p_amount,
          updated_at = now()
      where profile_id = p_profile_id and usage_date = v_today and metric = p_metric;
    return 'service_exhausted';
  end if;
  return 'allowed';
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by default; this is an API service primitive.
revoke all on function public.consume_daily_usage_with_service_limit(uuid, text, bigint, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.consume_daily_usage_with_service_limit(uuid, text, bigint, bigint, bigint)
  to service_role;
