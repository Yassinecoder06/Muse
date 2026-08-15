-- Uploaded source material is kept as extracted text. This keeps research
-- runs reproducible without storing executable office-document payloads.
create table public.research_documents (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 255),
  mime text not null,
  size integer not null check (size > 0 and size <= 10485760),
  content text not null check (char_length(content) > 0 and char_length(content) <= 60000),
  created_at timestamptz not null default now()
);

create table public.research_artifacts (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage text not null check (stage in ('research', 'extraction', 'analysis', 'critical_reasoning', 'recommendations', 'structure', 'writing', 'quality_control')),
  content text not null,
  created_at timestamptz not null default now(),
  unique (job_id, stage)
);

create index research_documents_user_created_at_idx on public.research_documents(user_id, created_at desc);
create index research_artifacts_job_stage_idx on public.research_artifacts(job_id, stage);

grant select, insert, delete on public.research_documents to authenticated, service_role;
grant select, insert, delete on public.research_artifacts to authenticated, service_role;

alter table public.research_documents enable row level security;
alter table public.research_artifacts enable row level security;

create policy "research documents belong to user" on public.research_documents for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "research artifacts belong to user" on public.research_artifacts for select to authenticated
  using (user_id = auth.uid());
