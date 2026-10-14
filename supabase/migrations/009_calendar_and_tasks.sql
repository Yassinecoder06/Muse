-- 009: local-first default user, calendar events table, and standalone tasks with due dates.

-- 1. Ensure default local user exists in auth.users for local-first operations
insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-000000000001',
  'local@muse.local',
  '{"full_name": "Local User"}'::jsonb
)
on conflict (id) do update set raw_user_meta_data = excluded.raw_user_meta_data;

-- 2. Enhance tasks table to support standalone tasks and scheduled due dates
alter table public.tasks alter column note_id drop not null;
alter table public.tasks add column if not exists due_date date;
alter table public.tasks add column if not exists due_time time;
alter table public.tasks add column if not exists priority text default 'medium';
create index if not exists tasks_user_due_date_idx on public.tasks(user_id, due_date);

-- 3. Create events table for calendar
create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete set null,
  title text not null,
  description text default '',
  start_time timestamptz not null,
  end_time timestamptz,
  all_day boolean not null default false,
  location text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_user_start_idx on public.events(user_id, start_time);

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.events to anon, authenticated, service_role;

alter table public.events enable row level security;
drop policy if exists "events belong to user" on public.events;
create policy "events belong to user" on public.events for all to authenticated using (true) with check (true);
drop policy if exists "events anon access" on public.events;
create policy "events anon access" on public.events for all to anon using (true) with check (true);
