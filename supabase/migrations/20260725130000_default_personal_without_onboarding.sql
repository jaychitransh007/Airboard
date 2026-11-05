-- New accounts enter their personal workspace immediately. The existing auth
-- bootstrap already creates a personal organization and default "My Airboards"
-- workspace, so no user-facing onboarding step is required.

alter table public.profiles
  alter column onboarding_completed_at set default now();

update public.profiles
set onboarding_completed_at = coalesce(onboarding_completed_at, created_at, now())
where onboarding_completed_at is null;
