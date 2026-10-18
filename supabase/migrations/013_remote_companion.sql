-- 013: Remote Phone Companion setup and device registration

-- 1. Paired Remote Devices
create table if not exists public.remote_devices (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null,
  device_model text,
  platform text not null default 'android',
  device_token text not null unique,
  last_ip text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists remote_devices_user_idx
  on public.remote_devices(user_id, last_seen_at desc);

create index if not exists remote_devices_token_idx
  on public.remote_devices(device_token);

-- 2. Temporary Pairing Tokens
create table if not exists public.pairing_tokens (
  token text primary key,
  pin_code text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  server_url text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz default null,
  claimed_by_device uuid references public.remote_devices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pairing_tokens_pin_idx
  on public.pairing_tokens(pin_code, expires_at desc);

-- 3. Cleanup function for expired pairing tokens
create or replace function public.cleanup_expired_pairing_tokens()
returns void as $$
begin
  delete from public.pairing_tokens
  where expires_at < now() - interval '1 hour';
end;
$$ language plpgsql security definer;
