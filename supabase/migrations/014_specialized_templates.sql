-- 014: specialized note templates table
create table if not exists public.specialized_templates (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text default null,
  fields jsonb not null default '[]'::jsonb,
  ai_instruction text default null,
  color text default 'blue',
  sync_with_calendar boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists specialized_templates_user_idx
  on public.specialized_templates(user_id, updated_at desc);

drop trigger if exists specialized_templates_set_updated_at on public.specialized_templates;
create trigger specialized_templates_set_updated_at before update on public.specialized_templates
  for each row execute function public.set_updated_at();

-- Only the Express API (service role) touches templates.
alter table public.specialized_templates enable row level security;
revoke all on public.specialized_templates from anon, authenticated;
grant select, insert, update, delete on public.specialized_templates to service_role;

-- Reload postgrest schema cache
notify pgrst, 'reload schema';
