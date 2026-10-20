-- 020: music playlists table
create table if not exists public.music_playlists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text default '',
  tracks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists music_playlists_user_idx
  on public.music_playlists(user_id, updated_at desc);

drop trigger if exists music_playlists_set_updated_at on public.music_playlists;
create trigger music_playlists_set_updated_at before update on public.music_playlists
  for each row execute function public.set_updated_at();

alter table public.music_playlists enable row level security;
revoke all on public.music_playlists from anon, authenticated;
grant select, insert, update, delete on public.music_playlists to service_role;

notify pgrst, 'reload schema';
