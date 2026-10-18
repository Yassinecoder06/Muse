-- 012: Persistent chat sessions, message history with tool execution tracking, and user memories.

-- 1. Chat Sessions table
create table if not exists public.chat_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New Conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_updated_idx
  on public.chat_sessions(user_id, updated_at desc);

drop trigger if exists chat_sessions_set_updated_at on public.chat_sessions;
create trigger chat_sessions_set_updated_at before update on public.chat_sessions
  for each row execute function public.set_updated_at();

-- 2. Chat Messages table
create table if not exists public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  tool_calls jsonb default '[]'::jsonb,
  tool_results jsonb default '[]'::jsonb,
  sources jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx
  on public.chat_messages(session_id, created_at asc);
create index if not exists chat_messages_user_idx
  on public.chat_messages(user_id, created_at desc);

-- 3. User Memories table
create table if not exists public.user_memories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fact text not null,
  category text not null default 'general' check (category in ('preference', 'project', 'personal', 'goal', 'general')),
  source_session_id uuid references public.chat_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_memories_user_idx
  on public.user_memories(user_id, updated_at desc);

drop trigger if exists user_memories_set_updated_at on public.user_memories;
create trigger user_memories_set_updated_at before update on public.user_memories
  for each row execute function public.set_updated_at();

-- 4. Grants and Permissions
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.chat_sessions to anon, authenticated, service_role;
grant select, insert, update, delete on public.chat_messages to anon, authenticated, service_role;
grant select, insert, update, delete on public.user_memories to anon, authenticated, service_role;

-- 5. Row Level Security
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.user_memories enable row level security;

drop policy if exists "chat_sessions authenticated" on public.chat_sessions;
create policy "chat_sessions authenticated" on public.chat_sessions for all to authenticated using (true) with check (true);
drop policy if exists "chat_sessions anon" on public.chat_sessions;
create policy "chat_sessions anon" on public.chat_sessions for all to anon using (true) with check (true);

drop policy if exists "chat_messages authenticated" on public.chat_messages;
create policy "chat_messages authenticated" on public.chat_messages for all to authenticated using (true) with check (true);
drop policy if exists "chat_messages anon" on public.chat_messages;
create policy "chat_messages anon" on public.chat_messages for all to anon using (true) with check (true);

drop policy if exists "user_memories authenticated" on public.user_memories;
create policy "user_memories authenticated" on public.user_memories for all to authenticated using (true) with check (true);
drop policy if exists "user_memories anon" on public.user_memories;
create policy "user_memories anon" on public.user_memories for all to anon using (true) with check (true);
