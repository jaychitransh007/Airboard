-- Export and account deletion look rows up by profile; without these
-- indexes both scan the two largest tables in full.

create index if not exists product_events_profile_idx
  on public.product_events (profile_id)
  where profile_id is not null;

create index if not exists audit_events_actor_profile_idx
  on public.audit_events (actor_profile_id)
  where actor_profile_id is not null;

-- Every erasure step is safe to repeat, so POST /internal/lifecycle/run puts a
-- failed request back on the queue and marks it failed only after five
-- attempts. This counts them.

alter table public.data_requests
  add column if not exists attempts integer not null default 0;

comment on column public.data_requests.attempts is
  'Failed processing attempts; the request is marked failed after five.';
