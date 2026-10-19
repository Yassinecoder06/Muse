-- 018: bring-your-own AI providers.
-- Users can add any number of providers (Gemini, OpenAI, Anthropic, Ollama
-- Cloud/Local, OpenAI- or Anthropic-compatible APIs). Keys live in Supabase
-- Vault (secret name 'provider:<id>'); the table only stores metadata and the
-- last fetched model list. ai_preferences holds which model does which job.

create table if not exists public.ai_providers (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('gemini', 'openai', 'anthropic', 'ollama_cloud', 'ollama_local', 'openai_compatible', 'anthropic_compatible')),
  name text not null,
  base_url text,
  enabled boolean not null default true,
  models jsonb not null default '[]'::jsonb,
  last_fetched_at timestamptz,
  last_error text,
  key_hint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_providers_user_idx on public.ai_providers(user_id, created_at);

drop trigger if exists ai_providers_set_updated_at on public.ai_providers;
create trigger ai_providers_set_updated_at before update on public.ai_providers
  for each row execute function public.set_updated_at();

create table if not exists public.ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Model refs are '<provider id>:<model id>' or 'builtin:<name>'.
  chat jsonb not null default '[]'::jsonb,   -- ordered: first is used, the rest are fallbacks
  embedding text,
  tts text,
  tts_voice text,
  stt text,
  updated_at timestamptz not null default now()
);

alter table public.ai_providers enable row level security;
alter table public.ai_preferences enable row level security;
revoke all on public.ai_providers from anon, authenticated;
revoke all on public.ai_preferences from anon, authenticated;
grant select, insert, update, delete on public.ai_providers to service_role;
grant select, insert, update, delete on public.ai_preferences to service_role;

create or replace function public.ai_provider_secret_save(p_provider_id uuid, p_api_key text)
returns void
language plpgsql security definer set search_path = public, vault as $$
declare secret_id uuid;
begin
  select s.id into secret_id from vault.secrets s where s.name = 'provider:' || p_provider_id::text limit 1;
  if secret_id is null then
    perform vault.create_secret(p_api_key, 'provider:' || p_provider_id::text, 'Muse AI provider key');
  else
    perform vault.update_secret(secret_id, p_api_key, 'provider:' || p_provider_id::text, 'Muse AI provider key');
  end if;
end $$;

create or replace function public.ai_provider_secret_get(p_provider_id uuid)
returns text
language plpgsql security definer set search_path = public, vault as $$
declare result text;
begin
  begin
    select decrypted_secret into result from vault.decrypted_secrets where name = 'provider:' || p_provider_id::text limit 1;
  exception when others then
    return null; -- undecryptable (root key changed): ask the user to re-enter it
  end;
  return result;
end $$;

create or replace function public.ai_provider_secret_delete(p_provider_id uuid)
returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where name = 'provider:' || p_provider_id::text;
end $$;

revoke all on function public.ai_provider_secret_save(uuid, text) from public, anon, authenticated;
revoke all on function public.ai_provider_secret_get(uuid) from public, anon, authenticated;
revoke all on function public.ai_provider_secret_delete(uuid) from public, anon, authenticated;
grant execute on function public.ai_provider_secret_save(uuid, text) to service_role;
grant execute on function public.ai_provider_secret_get(uuid) to service_role;
grant execute on function public.ai_provider_secret_delete(uuid) to service_role;

notify pgrst, 'reload schema';
