-- 010: specialized notes support in standard notes table (zero-vault dependency)

-- 1. Allow 'specialized' kind in notes table
alter table public.notes drop constraint if exists notes_kind_check;
alter table public.notes add constraint notes_kind_check check (kind in ('note', 'research', 'specialized'));

-- 2. Add specialized jsonb column for structured fields
alter table public.notes add column if not exists specialized jsonb;

-- 3. Notify PostgREST to reload its schema cache
notify pgrst, 'reload schema';
