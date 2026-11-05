alter table public.platform_installations
  add column if not exists external_package_id text;

-- Existing Chrome rows used the package ID as their installation identity.
-- Preserve that address for web-to-extension messaging; upgraded and new
-- clients write a stable per-profile UUID to external_installation_id.
update public.platform_installations
set external_package_id = external_installation_id
where platform = 'chrome_meet'
  and external_package_id is null;

create index if not exists platform_installations_chrome_package_idx
  on public.platform_installations (organization_id, external_package_id)
  where platform = 'chrome_meet';

comment on column public.platform_installations.external_installation_id is
  'Provider installation instance identifier. Chrome clients use a random UUID persisted in extension storage, never the shared package ID.';

comment on column public.platform_installations.external_package_id is
  'Provider package/application identifier used to address the installed client; shared by every installation of a published Chrome extension.';
