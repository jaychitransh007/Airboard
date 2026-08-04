-- Keep Chrome installation credential rotation and verified preflight state
-- transitions atomic. These functions are service-role-only API primitives;
-- browser clients never call them directly.

create or replace function public.rotate_chrome_installation_credential(
  p_installation_id uuid,
  p_organization_id uuid,
  p_presented_token_hash text,
  p_presented_token_expires_at timestamptz,
  p_new_token_hash text,
  p_token_expires_at timestamptz,
  p_previous_token_expires_at timestamptz
)
returns table (installation_id uuid, rotation_mode text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_token_hash text;
  v_previous_token_hash text;
  v_previous_token_expires_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  select
    installation.token_hash,
    installation.previous_token_hash,
    installation.previous_token_expires_at
  into
    v_current_token_hash,
    v_previous_token_hash,
    v_previous_token_expires_at
  from public.platform_installations as installation
  where installation.id = p_installation_id
    and installation.organization_id = p_organization_id
    and installation.status <> 'revoked'
  for update;

  if not found then
    return;
  end if;

  if v_current_token_hash = p_presented_token_hash then
    update public.platform_installations
    set
      previous_token_hash = p_presented_token_hash,
      previous_token_expires_at = p_previous_token_expires_at,
      token_hash = p_new_token_hash,
      token_expires_at = p_token_expires_at,
      last_seen_at = v_now,
      updated_at = v_now
    where id = p_installation_id
      and organization_id = p_organization_id;
    return query select p_installation_id, 'rotated'::text;
    return;
  end if;

  if v_previous_token_hash = p_presented_token_hash
    and v_previous_token_expires_at > v_now
  then
    -- A previous-token request is a retry whose earlier rotation response may
    -- have been lost. Promote the token the browser still owns and retain the
    -- unknown current token as grace. Concurrent responses are therefore both
    -- usable regardless of arrival order.
    update public.platform_installations
    set
      token_hash = p_presented_token_hash,
      token_expires_at = p_presented_token_expires_at,
      previous_token_hash = v_current_token_hash,
      previous_token_expires_at = p_previous_token_expires_at,
      last_seen_at = v_now,
      updated_at = v_now
    where id = p_installation_id
      and organization_id = p_organization_id;
    return query select p_installation_id, 'promoted'::text;
  end if;
end;
$$;

revoke all on function public.rotate_chrome_installation_credential(
  uuid, uuid, text, timestamptz, text, timestamptz, timestamptz
) from public;
grant execute on function public.rotate_chrome_installation_credential(
  uuid, uuid, text, timestamptz, text, timestamptz, timestamptz
) to service_role;

create or replace function public.commit_chrome_installation_consent(
  p_installation_id uuid,
  p_organization_id uuid,
  p_presented_token_hash text
)
returns table (installed_by uuid, consented_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_installed_by uuid;
  v_consented_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  -- Recheck the tenant, revoke state, platform and exact credential while the
  -- installation row is locked. Consent and revocation therefore have one
  -- deterministic order, and a stale credential cannot commit after rotation.
  select
    installation.installed_by,
    installation.consented_at
  into
    v_installed_by,
    v_consented_at
  from public.platform_installations as installation
  where installation.id = p_installation_id
    and installation.organization_id = p_organization_id
    and installation.platform = 'chrome_meet'
    and installation.status <> 'revoked'
    and (
      installation.token_hash = p_presented_token_hash
      or (
        installation.previous_token_hash = p_presented_token_hash
        and installation.previous_token_expires_at > v_now
      )
    )
  for update;

  if not found or v_installed_by is null then
    return;
  end if;

  v_consented_at := coalesce(v_consented_at, v_now);

  update public.platform_installations
  set
    consented_at = v_consented_at,
    updated_at = v_now
  where id = p_installation_id
    and organization_id = p_organization_id;

  -- The installation lock serializes retries. Fill any missing audit records
  -- without duplicating records after a lost response or repairing a legacy
  -- consent marker that was written before its audit insert failed.
  insert into public.consent_records (
    profile_id,
    organization_id,
    installation_id,
    consent_type,
    document_version,
    granted,
    source
  )
  select
    v_installed_by,
    p_organization_id,
    p_installation_id,
    requested.consent_type,
    '2026-07-18',
    true,
    'chrome_extension_popup'
  from unnest(array['camera', 'microphone', 'voice_processing']::text[])
    as requested(consent_type)
  where not exists (
    select 1
    from public.consent_records as existing
    where existing.profile_id = v_installed_by
      and existing.organization_id = p_organization_id
      and existing.installation_id = p_installation_id
      and existing.consent_type = requested.consent_type
      and existing.document_version = '2026-07-18'
      and existing.granted = true
      and existing.source = 'chrome_extension_popup'
  );

  return query select v_installed_by, v_consented_at;
end;
$$;

revoke all on function public.commit_chrome_installation_consent(
  uuid, uuid, text
) from public;
grant execute on function public.commit_chrome_installation_consent(
  uuid, uuid, text
) to service_role;

create or replace function public.complete_chrome_installation_preflight(
  p_installation_id uuid,
  p_organization_id uuid,
  p_presented_token_hash text,
  p_extension_version text
)
returns table (
  installed_by uuid,
  trial_activated boolean,
  trial_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_installed_by uuid;
  v_trial_id uuid;
  v_trial_activated boolean := false;
  v_trial_expires_at timestamptz := null;
  v_now timestamptz := clock_timestamp();
  v_entitlement_count integer := 0;
begin
  -- Lock and authenticate the exact tenant installation in the same
  -- transaction as every state/trial side effect. A concurrent revoke either
  -- wins first (and this returns no row) or runs after a valid preflight commit.
  select installation.installed_by
  into v_installed_by
  from public.platform_installations as installation
  where installation.id = p_installation_id
    and installation.organization_id = p_organization_id
    and installation.status <> 'revoked'
    and installation.consented_at is not null
    and (
      installation.token_hash = p_presented_token_hash
      or (
        installation.previous_token_hash = p_presented_token_hash
        and installation.previous_token_expires_at > v_now
      )
    )
  for update;

  if not found or v_installed_by is null then
    return;
  end if;

  update public.platform_installations
  set
    status = 'connected',
    version = p_extension_version,
    last_success_at = v_now,
    last_seen_at = v_now,
    last_error_code = null,
    updated_at = v_now
  where id = p_installation_id
    and organization_id = p_organization_id;

  select trial.id
  into v_trial_id
  from public.trial_eligibility as trial
  where trial.organization_id = p_organization_id
    and trial.status = 'eligible'
  for update;

  if found then
    v_trial_expires_at := v_now + interval '72 hours';

    update public.trial_eligibility
    set
      status = 'activated',
      activated_at = v_now,
      expires_at = v_trial_expires_at,
      activation_source = 'chrome_meet_sender_verified',
      updated_at = v_now
    where id = v_trial_id
      and status = 'eligible';

    if found then
      update public.entitlements
      set
        plan = 'personal_trial',
        status = 'trialing',
        source = 'trial',
        starts_at = v_now,
        valid_until = v_trial_expires_at,
        updated_at = v_now
      where organization_id = p_organization_id
        and source = 'trial';

      get diagnostics v_entitlement_count = row_count;
      if v_entitlement_count = 0 then
        insert into public.entitlements (
          user_id,
          organization_id,
          plan,
          status,
          source,
          feature_key,
          starts_at,
          valid_until,
          updated_at
        ) values (
          v_installed_by,
          p_organization_id,
          'personal_trial',
          'trialing',
          'trial',
          'airboard.presenter',
          v_now,
          v_trial_expires_at,
          v_now
        );
      end if;

      insert into public.notification_jobs (
        organization_id,
        profile_id,
        template_key,
        recipient_email,
        payload,
        send_after
      )
      select
        p_organization_id,
        v_installed_by,
        schedule.template_key,
        profile.email,
        jsonb_build_object(
          'displayName', profile.display_name,
          'expiresAt', v_trial_expires_at
        ),
        schedule.send_after
      from public.profiles as profile
      cross join (
        values
          ('trial_welcome'::text, v_now),
          ('trial_24_hours_remaining'::text, v_trial_expires_at - interval '24 hours'),
          ('trial_6_hours_remaining'::text, v_trial_expires_at - interval '6 hours'),
          ('trial_expired'::text, v_trial_expires_at)
      ) as schedule(template_key, send_after)
      where profile.id = v_installed_by
        and profile.email is not null;

      v_trial_activated := true;
    end if;
  end if;

  return query select v_installed_by, v_trial_activated, v_trial_expires_at;
end;
$$;

revoke all on function public.complete_chrome_installation_preflight(
  uuid, uuid, text, text
) from public;
grant execute on function public.complete_chrome_installation_preflight(
  uuid, uuid, text, text
) to service_role;

comment on function public.rotate_chrome_installation_credential(
  uuid, uuid, text, timestamptz, text, timestamptz, timestamptz
) is 'Atomically rotates a Chrome installation credential while preserving the credential presented by a retry.';

comment on function public.commit_chrome_installation_consent(
  uuid, uuid, text
) is 'Atomically records Chrome media consent for a live, credential-bound installation.';

comment on function public.complete_chrome_installation_preflight(
  uuid, uuid, text, text
) is 'Atomically verifies a non-revoked installation and commits preflight, trial entitlement, and lifecycle notifications.';
