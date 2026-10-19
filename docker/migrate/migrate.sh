#!/bin/sh
# Applies supabase/migrations/*.sql that this database has not run yet, in
# filename order, each in its own transaction, and records them in
# public.schema_migrations. Runs as the one-shot `migrate` Compose service
# before the API starts, so `docker compose up` keeps every database current.
set -eu

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
export PGOPTIONS="-c client_min_messages=warning" # hide "already exists, skipping" notices
DIR="${MIGRATIONS_DIR:-/migrations}"
psql_q() { psql -v ON_ERROR_STOP=1 -h "${DB_HOST:-db}" -U supabase_admin -d postgres -qAtX "$@"; }

until psql_q -c 'select 1' >/dev/null 2>&1; do echo "migrate: waiting for database…"; sleep 2; done

psql_q <<'SQL'
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
SQL

# Databases created before this runner existed already contain some of the
# migrations. On the first run, record a migration as applied when its main
# object exists, instead of running it again. Migrations added after the
# runner (018+) need no entry here.
marker() {
  case "$1" in
    001_*) echo "to_regclass('public.notes')" ;;
    002_*) echo "to_regclass('public.images')" ;;
    003_*) echo "to_regprocedure('public.api_key_save(uuid,text)')" ;;
    004_*) echo "(select 1 from information_schema.columns where table_schema='public' and table_name='notes' and column_name='kind')" ;;
    005_*) echo "to_regclass('public.research_documents')" ;;
    006_*) echo "to_regclass('public.report_metadata')" ;;
    007_*) echo "(select 1 from information_schema.columns where table_schema='public' and table_name='research_documents' and column_name='scan_status')" ;;
    008_*) echo "to_regclass('public.user_vaults')" ;;
    009_*) echo "(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='due_date')" ;;
    010_*) echo "(select 1 from information_schema.columns where table_schema='public' and table_name='notes' and column_name='specialized')" ;;
    011_*) echo "to_regclass('public.ai_usage_logs')" ;;
    012_*) echo "to_regclass('public.chat_sessions')" ;;
    013_*) echo "to_regclass('public.remote_devices')" ;;
    014_*) echo "to_regclass('public.specialized_templates')" ;;
    015_*) echo "to_regclass('public.app_owner')" ;;
    016_*) echo "to_regclass('public.ai_jobs_one_active_per_user')" ;;
    017_*) echo "(select 1 from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='reminder_at')" ;;
    *) echo "null" ;;
  esac
}

if [ "$(psql_q -c 'select count(*) from public.schema_migrations')" = "0" ]; then
  for file in "$DIR"/*.sql; do
    name="$(basename "$file")"
    if [ "$(psql_q -c "select ($(marker "$name")) is not null")" = "t" ]; then
      psql_q -c "insert into public.schema_migrations(name) values ('$name') on conflict do nothing"
      echo "migrate: $name already present, recorded"
    fi
  done
fi

applied=0
for file in "$DIR"/*.sql; do
  name="$(basename "$file")"
  if [ -z "$(psql_q -c "select 1 from public.schema_migrations where name = '$name'")" ]; then
    echo "migrate: applying $name"
    # One transaction per file: a failing migration leaves nothing half-done
    # and stops the API from starting against a broken schema.
    # (`-f -` because psql only wraps -f/-c input in --single-transaction.)
    { cat "$file"; printf "\ninsert into public.schema_migrations(name) values ('%s');\n" "$name"; } | psql_q --single-transaction -f -
    applied=$((applied + 1))
  fi
done
echo "migrate: done ($applied applied)"
