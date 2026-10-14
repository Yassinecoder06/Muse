-- 008: additive secure-vault and WebAuthn support.
--
-- This migration deliberately does not alter or remove legacy encrypted
-- columns. Existing rows remain the source of truth until a client has copied
-- and verified its ciphertext envelopes. See documentation/SECURITY_AND_MIGRATION.md.

create table if not exists public.user_vaults (
  user_id uuid primary key references auth.users(id) on delete cascade,
  vault_check_ciphertext text,
  encryption_version integer not null default 2,
  setup_completed_at timestamptz,
  migration_status text not null default 'legacy'
    check (migration_status in ('legacy', 'copying', 'verified', 'failed')),
  migration_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists user_vaults_set_updated_at on public.user_vaults;
create trigger user_vaults_set_updated_at before update on public.user_vaults
  for each row execute function public.set_updated_at();

create table if not exists public.webauthn_credentials (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  transports jsonb not null default '[]'::jsonb,
  device_type text,
  backed_up boolean not null default false,
  name text not null default 'Passkey',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists webauthn_credentials_user_active_idx
  on public.webauthn_credentials(user_id, created_at desc) where revoked_at is null;

create table if not exists public.webauthn_challenges (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('registration', 'authentication')),
  challenge_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists webauthn_challenges_active_idx
  on public.webauthn_challenges(expires_at) where used_at is null;

-- Opaque user content. The API never decrypts this table; its contents are
-- AES-GCM envelopes produced by an unlocked browser vault.
create table if not exists public.vault_records (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('note', 'template', 'research_document', 'research_artifact', 'report_metadata', 'attachment')),
  ciphertext text not null,
  encryption_version integer not null default 2,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists vault_records_user_type_updated_idx
  on public.vault_records(user_id, record_type, updated_at desc);
drop trigger if exists vault_records_set_updated_at on public.vault_records;
create trigger vault_records_set_updated_at before update on public.vault_records
  for each row execute function public.set_updated_at();

-- Existing note IDs are preserved when migrated. These additive columns make
-- it possible for administrators to inspect migration state without exposing
-- content, and leave title/content untouched for legacy rollback.
alter table public.notes add column if not exists vault_record_id uuid;
alter table public.notes add column if not exists vault_migrated_at timestamptz;
create unique index if not exists notes_vault_record_id_unique
  on public.notes(vault_record_id) where vault_record_id is not null;

grant select, insert, update, delete on public.user_vaults, public.webauthn_credentials,
  public.webauthn_challenges, public.vault_records to authenticated, service_role;

alter table public.user_vaults enable row level security;
alter table public.webauthn_credentials enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.vault_records enable row level security;

drop policy if exists "vault belongs to user" on public.user_vaults;
create policy "vault belongs to user" on public.user_vaults for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "passkeys belong to user" on public.webauthn_credentials;
create policy "passkeys belong to user" on public.webauthn_credentials for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "vault records belong to user" on public.vault_records;
create policy "vault records belong to user" on public.vault_records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Challenges are server-only. Even an authenticated browser should not be
-- able to query or manipulate them through PostgREST.
revoke all on public.webauthn_challenges from anon, authenticated;
