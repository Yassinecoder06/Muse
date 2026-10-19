-- 015: security hardening
-- * Single-owner passphrase login (local-first mode without an open API).
-- * Device tokens are stored only as SHA-256 hashes.
-- * Tables added after 012 get RLS and lose anon/authenticated access. The
--   Express API uses the service role, so nothing in Muse reads these tables
--   through PostgREST with the public anon key.

create extension if not exists pgcrypto with schema extensions;

-- 1. Owner passphrase. There is exactly one row (id = 1) once configured.
create table if not exists public.app_owner (
  id smallint primary key default 1 check (id = 1),
  passphrase_hash text not null,
  -- Rotating the salt invalidates every issued session cookie.
  session_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists app_owner_set_updated_at on public.app_owner;
create trigger app_owner_set_updated_at before update on public.app_owner
  for each row execute function public.set_updated_at();

-- 2. Hash device tokens. Already-paired phones keep working because the API
--    hashes the presented token and looks it up by hash.
alter table public.remote_devices add column if not exists token_hash text;
update public.remote_devices
  set token_hash = encode(extensions.digest(device_token, 'sha256'), 'hex')
  where token_hash is null and device_token is not null;
alter table public.remote_devices alter column device_token drop not null;
update public.remote_devices set device_token = null where device_token is not null;
alter table public.remote_devices alter column token_hash set not null;
create unique index if not exists remote_devices_token_hash_idx on public.remote_devices(token_hash);
drop index if exists public.remote_devices_token_idx;

-- 3. Lock down tables that were created without RLS.
alter table public.app_owner enable row level security;
alter table public.remote_devices enable row level security;
alter table public.pairing_tokens enable row level security;
alter table public.specialized_templates enable row level security;
alter table public.ai_usage_logs enable row level security;

revoke all on public.app_owner from anon, authenticated;
revoke all on public.remote_devices from anon, authenticated;
revoke all on public.pairing_tokens from anon, authenticated;
revoke all on public.specialized_templates from anon, authenticated;
revoke all on public.ai_usage_logs from anon, authenticated;

grant select, insert, update, delete on public.app_owner to service_role;
grant select, insert, update, delete on public.remote_devices to service_role;
grant select, insert, update, delete on public.pairing_tokens to service_role;
grant select, insert, update, delete on public.specialized_templates to service_role;
grant select, insert, update, delete on public.ai_usage_logs to service_role;

notify pgrst, 'reload schema';
