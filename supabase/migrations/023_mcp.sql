-- OAuth/MCP credentials are stored as SHA-256 hashes only. All access goes
-- through the Express service role; browser clients cannot query these rows.
create table if not exists public.mcp_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_id text not null unique,
  client_secret_hash text,
  name text not null,
  redirect_uris jsonb not null default '[]'::jsonb,
  scopes text[] not null default '{}',
  approval_mode text check (approval_mode in ('trust','minimal','standard')),
  remembered boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists public.mcp_tokens (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null, token_hash text not null unique,
  type text not null check (type in ('pat','oauth_access','oauth_refresh')),
  scopes text[] not null default '{}', expires_at timestamptz, revoked_at timestamptz,
  family_id uuid not null default gen_random_uuid(), replaced_by uuid,
  label text, created_at timestamptz not null default now(), last_used_at timestamptz
);
create table if not exists public.mcp_auth_codes (
  code_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null, redirect_uri text not null, scopes text[] not null,
  code_challenge text not null, state text, approval_mode text not null,
  expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.mcp_approvals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null, tool text not null, target text, args jsonb not null default '{}'::jsonb,
  summary text not null, status text not null default 'pending' check (status in ('pending','approved','denied','executed','failed','expired')),
  result jsonb, expires_at timestamptz not null default now() + interval '60 minutes', decided_at timestamptz,
  execution_started_at timestamptz, executed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.mcp_activity (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null, tool text not null, risk text not null, target text, summary text not null,
  outcome text not null check (outcome in ('ok','error','pending_approval')),
  status text not null default 'completed', undo_id uuid, created_at timestamptz not null default now()
);
create table if not exists public.mcp_undo (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null, tool text not null, item_type text not null, target_id text, snapshot jsonb not null,
  expires_at timestamptz not null default now() + interval '7 days', used_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.mcp_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_mode text not null default 'minimal' check (default_mode in ('trust','minimal','standard')),
  timezone text not null default 'UTC', updated_at timestamptz not null default now()
);
create index if not exists mcp_tokens_user_idx on public.mcp_tokens(user_id, created_at desc);
create index if not exists mcp_tokens_family_idx on public.mcp_tokens(family_id);
create index if not exists mcp_codes_expiry_idx on public.mcp_auth_codes(expires_at);
create index if not exists mcp_approvals_user_idx on public.mcp_approvals(user_id, status, created_at desc);
create index if not exists mcp_activity_user_idx on public.mcp_activity(user_id, created_at desc);
create index if not exists mcp_undo_user_idx on public.mcp_undo(user_id, expires_at);
alter table public.mcp_clients enable row level security;
alter table public.mcp_tokens enable row level security;
alter table public.mcp_auth_codes enable row level security;
alter table public.mcp_approvals enable row level security;
alter table public.mcp_activity enable row level security;
alter table public.mcp_undo enable row level security;
alter table public.mcp_settings enable row level security;
revoke all on public.mcp_clients, public.mcp_tokens, public.mcp_auth_codes, public.mcp_approvals, public.mcp_activity, public.mcp_undo, public.mcp_settings from anon, authenticated;
grant select, insert, update, delete on public.mcp_clients, public.mcp_tokens, public.mcp_auth_codes, public.mcp_approvals, public.mcp_activity, public.mcp_undo, public.mcp_settings to service_role;
notify pgrst, 'reload schema';
