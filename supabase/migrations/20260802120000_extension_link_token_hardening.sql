alter table public.platform_installations
  add column if not exists link_token_hash text,
  add column if not exists link_token_expires_at timestamptz;

comment on column public.platform_installations.link_token_hash is
  'SHA-256 digest of the current single-use browser link credential. Cleared atomically on exchange.';

comment on column public.platform_installations.link_token_expires_at is
  'Server-side expiry for the current single-use browser link credential.';
