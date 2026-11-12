-- Drop the tables and functions nothing uses after the 12 November 2026
-- removals (Chrome extension, Meet add-on, desktop app, SSO/SCIM and
-- board-history writes; see Docs/Cleanup Review.md), plus three tables from
-- the first schema that were never written.
--
-- Checked before writing this: no code in apps/api/src, apps/web/src or
-- scripts reads or writes these tables (the web never queries tables
-- directly), supabase/seed.sql does not touch them, and no remaining
-- function, trigger, view or policy on another table mentions them.
--
-- Dropped functions (security-definer RPCs only the extension's routes called;
-- nothing calls them since those routes were removed):
--   rotate_chrome_installation_credential  extension token rotation
--   commit_chrome_installation_consent     extension consent
--   complete_chrome_installation_preflight extension preflight and pilot
--                                          activation through the extension
--
-- Dropped tables:
--   platform_installations     the extension's installations; last read by
--                              the account export and erasure, which no
--                              longer touch it
--   board_versions             a full copy of the board per save; never read,
--                              and saves stopped writing it on 12 Nov 2026
--   identity_provider_configs  SSO settings; routes removed
--   scim_access_tokens         SCIM tokens; routes removed
--   directory_users            SCIM directory; routes removed
--   organization_domains       domain verification for SSO; never used
--   analytics_events           initial schema; replaced by product_events
--   board_snapshots            initial schema; never written
--   exports                    initial schema (PNG/PDF export paths); never
--                              written
--
-- Kept: consent_records.installation_id and product_events.installation_id.
-- Only their foreign keys to platform_installations go. Consent records are
-- the append-only proof of consent, so old rows keep the id they were given.
--
-- Each table's own policies and indexes go with it. No cascade: if anything
-- still depended on a table, this migration would fail instead of silently
-- removing it.

-- Dropping the two foreign keys briefly locks product_events and
-- consent_records; give up rather than queue every insert behind a long
-- delete (such as the 90-day product_events expiry).
set lock_timeout = '5s';

drop function if exists public.complete_chrome_installation_preflight(uuid, uuid, text, text);
drop function if exists public.commit_chrome_installation_consent(uuid, uuid, text);
drop function if exists public.rotate_chrome_installation_credential(
  uuid, uuid, text, timestamptz, text, timestamptz, timestamptz
);

alter table public.consent_records
  drop constraint if exists consent_records_installation_id_fkey;
alter table public.product_events
  drop constraint if exists product_events_installation_id_fkey;

drop table if exists public.platform_installations;
drop table if exists public.board_versions;
drop table if exists public.directory_users;
drop table if exists public.scim_access_tokens;
drop table if exists public.identity_provider_configs;
drop table if exists public.organization_domains;
drop table if exists public.analytics_events;
drop table if exists public.board_snapshots;
drop table if exists public.exports;
