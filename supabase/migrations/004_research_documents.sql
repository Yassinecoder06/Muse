alter table public.notes
  add column if not exists kind text not null default 'note'
  check (kind in ('note', 'research'));

create index if not exists notes_user_kind_updated_at_idx
  on public.notes(user_id, kind, updated_at desc);
