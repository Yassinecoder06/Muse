-- 019: remember when a task was checked off, so analytics can chart real
-- completions (not "completed tasks grouped by creation day").
-- A trigger keeps it right for every write path (API, Bip tools, phone).
alter table public.tasks add column if not exists completed_at timestamptz;

-- Older completions have no record of when they happened; their creation time
-- is the closest honest guess.
update public.tasks set completed_at = created_at where completed and completed_at is null;

create or replace function public.tasks_track_completion() returns trigger
language plpgsql as $$
begin
  if new.completed and (tg_op = 'INSERT' or not old.completed) then
    new.completed_at := coalesce(new.completed_at, now());
  elsif not new.completed then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_track_completion on public.tasks;
create trigger tasks_track_completion before insert or update of completed on public.tasks
  for each row execute function public.tasks_track_completion();

create index if not exists tasks_user_completed_at_idx on public.tasks(user_id, completed_at) where completed_at is not null;
