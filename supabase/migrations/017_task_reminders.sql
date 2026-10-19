-- 017: per-task reminders ("10 minutes before" or an exact time).
-- reminder_at is the moment to alert (computed in the user's timezone by the
-- API); reminder_minutes_before is kept so moving the due time moves the alert.
alter table public.tasks add column if not exists reminder_at timestamptz;
alter table public.tasks add column if not exists reminder_minutes_before integer
  check (reminder_minutes_before is null or reminder_minutes_before between 0 and 43200);
create index if not exists tasks_user_reminder_idx on public.tasks(user_id, reminder_at) where reminder_at is not null;
