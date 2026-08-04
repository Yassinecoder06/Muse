create extension if not exists "uuid-ossp";

create table public.notes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '', content text not null default '', summary text,
  favorite boolean not null default false, archived boolean not null default false,
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.tags (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, unique (user_id, name)
);
create table public.note_tags (
  note_id uuid not null references public.notes(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (note_id, tag_id)
);
create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid not null references public.notes(id) on delete cascade,
  text text not null, completed boolean not null default false, created_at timestamptz not null default now()
);
create table public.ai_jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete cascade,
  type text not null check (type in ('organize', 'summary', 'tasks', 'title', 'tags', 'rewrite', 'ask_note', 'ask_search')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'processing', 'complete', 'failed')),
  attempts integer not null default 0,
  error text, result jsonb, created_at timestamptz not null default now(), started_at timestamptz, finished_at timestamptz
);

create index notes_user_updated_at_idx on public.notes(user_id, updated_at desc);
create index notes_user_favorite_idx on public.notes(user_id) where favorite;
create index tasks_user_note_idx on public.tasks(user_id, note_id);
create index ai_jobs_queue_idx on public.ai_jobs(status, created_at) where status = 'queued';
create index ai_jobs_user_status_idx on public.ai_jobs(user_id, status, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger notes_set_updated_at before update on public.notes for each row execute function public.set_updated_at();

create or replace function public.claim_next_ai_job()
returns setof public.ai_jobs language sql security definer set search_path = public as $$
  with next_job as (
    select id from public.ai_jobs where status = 'queued' order by created_at for update skip locked limit 1
  )
  update public.ai_jobs set status = 'processing', attempts = attempts + 1, started_at = now()
  where id = (select id from next_job) returning *;
$$;
create or replace function public.requeue_stuck_ai_jobs()
returns integer language plpgsql security definer set search_path = public as $$
declare recovered integer;
begin
  update public.ai_jobs set status = 'queued', started_at = null
  where status = 'processing' and started_at < now() - interval '10 minutes';
  get diagnostics recovered = row_count;
  return recovered;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function public.claim_next_ai_job() to service_role;
grant execute on function public.requeue_stuck_ai_jobs() to service_role;

alter table public.notes enable row level security;
alter table public.tags enable row level security;
alter table public.note_tags enable row level security;
alter table public.tasks enable row level security;
alter table public.ai_jobs enable row level security;

create policy "notes belong to user" on public.notes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tags belong to user" on public.tags for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "tasks belong to user" on public.tasks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "jobs belong to user" on public.ai_jobs for select to authenticated using (user_id = auth.uid());
create policy "jobs can be created by user" on public.ai_jobs for insert to authenticated with check (user_id = auth.uid());
create policy "note tags belong to note owner" on public.note_tags for all to authenticated
  using (exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid()))
  with check (
    exists (select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid())
    and exists (select 1 from public.tags t where t.id = tag_id and t.user_id = auth.uid())
  );
