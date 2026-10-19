-- 016: one active AI job per user, enforced by the database.
-- The API checked for an active job before inserting, but two quick requests
-- could both pass that check. This partial unique index makes the second
-- insert fail instead (the API turns that into "already working on it").

-- Older duplicates (from before this index) would block its creation: keep the
-- newest active job per user and fail the rest.
update public.ai_jobs j
set status = 'failed', error = 'Superseded by a newer request.', finished_at = now()
where status in ('queued', 'processing')
  and exists (
    select 1 from public.ai_jobs newer
    where newer.user_id = j.user_id
      and newer.status in ('queued', 'processing')
      and newer.created_at > j.created_at
  );

create unique index if not exists ai_jobs_one_active_per_user
  on public.ai_jobs(user_id)
  where status in ('queued', 'processing');
