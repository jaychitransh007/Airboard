insert into public.profiles (id, local_user_key, email, display_name)
values
  ('00000000-0000-0000-0000-000000000001', 'local-owner', 'owner@airboard.local', 'Local Owner'),
  ('00000000-0000-0000-0000-000000000002', 'expired-owner', 'expired@airboard.local', 'Expired Owner')
on conflict (id) do update set
  local_user_key = excluded.local_user_key,
  email = excluded.email,
  display_name = excluded.display_name;

insert into public.entitlements (id, user_id, plan, status, source, valid_until)
values
  (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000001',
    'dev_pro',
    'active',
    'local_seed',
    now() + interval '1 year'
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000002',
    'dev_pro',
    'expired',
    'local_seed',
    now() - interval '1 day'
  )
on conflict (id) do update set
  status = excluded.status,
  valid_until = excluded.valid_until;
