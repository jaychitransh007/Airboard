-- Supabase grants EXECUTE on new public functions directly to anon and
-- authenticated through its default privileges. These security-definer RPCs
-- are API service primitives, so revoking PUBLIC alone is not sufficient.

revoke all on function public.rotate_chrome_installation_credential(
  uuid, uuid, text, timestamptz, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.rotate_chrome_installation_credential(
  uuid, uuid, text, timestamptz, text, timestamptz, timestamptz
) to service_role;

revoke all on function public.commit_chrome_installation_consent(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.commit_chrome_installation_consent(
  uuid, uuid, text
) to service_role;

revoke all on function public.complete_chrome_installation_preflight(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.complete_chrome_installation_preflight(
  uuid, uuid, text, text
) to service_role;
