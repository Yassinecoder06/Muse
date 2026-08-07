create table public.images (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id uuid references public.notes(id) on delete set null,
  mime text not null,
  size integer not null,
  data text not null,
  created_at timestamptz not null default now()
);
create index images_user_idx on public.images(user_id);
create index images_note_idx on public.images(note_id);

alter table public.images enable row level security;

create policy "images belong to user" on public.images for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.images to authenticated, service_role;