-- Document and index the operational retention enforced by
-- POST /internal/lifecycle/run. The application job owns deletion so it can
-- report failures and run consistently across hosted Postgres environments.

create index if not exists product_events_received_retention_idx
  on public.product_events (received_at);

create index if not exists audit_events_occurred_retention_idx
  on public.audit_events (occurred_at);

create index if not exists marketing_leads_created_retention_idx
  on public.marketing_leads (created_at);

create index if not exists support_requests_status_updated_retention_idx
  on public.support_requests (status, updated_at);

create index if not exists notification_jobs_status_created_retention_idx
  on public.notification_jobs (status, created_at);

comment on table public.product_events is
  'Content-free product analytics; lifecycle hard-deletes records after 90 days.';

comment on table public.audit_events is
  'Administrative and security audit metadata; lifecycle hard-deletes records after 365 days.';

comment on table public.marketing_leads is
  'Evaluation request details and short one-way IP hash; lifecycle hard-deletes records after 365 days.';

comment on table public.support_requests is
  'User-submitted support messages; resolved or closed records are hard-deleted after 365 days.';

comment on column public.data_requests.result is
  'Portable export payload; lifecycle clears the payload seven days after completion and removes terminal request metadata after 30 days.';

comment on table public.notification_jobs is
  'Lifecycle email delivery queue; sent and canceled records are hard-deleted after 30 days.';
