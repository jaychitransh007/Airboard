-- Keep one bounded-overlap installation credential so a lost refresh response
-- cannot strand a Chrome installation. Revocation clears both hashes.
alter table public.platform_installations
  add column if not exists previous_token_hash text,
  add column if not exists previous_token_expires_at timestamptz;

comment on column public.platform_installations.previous_token_hash is
  'SHA-256 of the immediately previous browser-installation credential during bounded rotation overlap.';
