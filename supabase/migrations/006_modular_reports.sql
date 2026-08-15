alter table public.research_artifacts drop constraint if exists research_artifacts_stage_check;
alter table public.research_artifacts add constraint research_artifacts_stage_check check (stage in ('planning', 'skill_selection', 'research', 'extraction', 'analysis', 'data_analysis', 'critical_reasoning', 'financial_analysis', 'recommendations', 'visualization', 'structure', 'writing', 'citation_management', 'quality_control', 'revision'));

create table public.report_metadata (
  note_id uuid primary key references public.notes(id) on delete cascade,
  job_id uuid not null references public.ai_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null,
  objective text not null default '', audience text not null default '', instructions text not null default '',
  output_format text not null default 'html' check (output_format in ('html', 'pdf', 'docx')),
  plan jsonb not null default '{}'::jsonb, quality jsonb not null default '{}'::jsonb,
  revision_count integer not null default 0, created_at timestamptz not null default now()
);
create table public.report_stage_runs (
  id uuid primary key default uuid_generate_v4(), job_id uuid not null references public.ai_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, skill text not null,
  execution_time_ms integer not null default 0, input_size integer not null default 0, output_size integer not null default 0,
  status text not null check (status in ('complete','failed','skipped')), error text, created_at timestamptz not null default now()
);
create index report_stage_runs_job_created_idx on public.report_stage_runs(job_id, created_at);
grant select, insert on public.report_metadata, public.report_stage_runs to authenticated, service_role;
alter table public.report_metadata enable row level security;
alter table public.report_stage_runs enable row level security;
create policy "report metadata belongs to user" on public.report_metadata for select to authenticated using (user_id = auth.uid());
create policy "report stage runs belong to user" on public.report_stage_runs for select to authenticated using (user_id = auth.uid());
