-- The pilot trial lasts one month (30 days) from activation, matching the API's
-- TRIAL_DURATION_MS. Only the trial interval changes; create or replace keeps
-- the function's existing grants.
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
    v_trial_expires_at := v_now + interval '30 days';

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

-- Pilots that started within the last month get the full month: extend the
-- trial, restore its access, and move unsent reminder emails to the new end.
-- Pilots that started earlier keep their original end.
with extended as (
  update public.trial_eligibility
  set status = 'activated',
      expires_at = activated_at + interval '30 days',
      updated_at = now()
  where status in ('activated', 'expired')
    and activated_at is not null
    and activated_at + interval '30 days' > now()
    and (expires_at is null or expires_at < activated_at + interval '30 days')
  returning organization_id, activated_at + interval '30 days' as new_expires_at
),
restored_access as (
  update public.entitlements e
  set status = 'trialing',
      valid_until = x.new_expires_at,
      updated_at = now()
  from extended x
  where e.organization_id = x.organization_id
    and e.source = 'trial'
    and e.status in ('trialing', 'expired')
  returning e.organization_id
)
update public.notification_jobs n
set send_after = case n.template_key
      when 'trial_24_hours_remaining' then x.new_expires_at - interval '24 hours'
      when 'trial_6_hours_remaining' then x.new_expires_at - interval '6 hours'
      else x.new_expires_at
    end,
    payload = n.payload || jsonb_build_object('expiresAt', x.new_expires_at)
from extended x
where n.organization_id = x.organization_id
  and n.status = 'queued'
  and n.template_key in ('trial_24_hours_remaining', 'trial_6_hours_remaining', 'trial_expired');
