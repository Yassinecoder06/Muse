-- 003: per-user Ollama API keys, encrypted in Supabase Vault.
-- The pgsodium root key is held in Docker's persistent pgsodium-key volume;
-- this migration creates the logical Vault key and exposes the app through
-- security-definer RPC functions executable by service_role only, so users
-- can never read or overwrite each other's keys (not even through PostgREST).

create extension if not exists pgsodium;

do $$
begin
  if not exists (select 1 from pgsodium.key) then
    perform pgsodium.create_key(name := 'muse-root');
  end if;
end $$;

create or replace function public.api_key_save(p_user_id uuid, p_api_key text)
returns void
language plpgsql security definer set search_path = public, vault as $$
declare secret_id uuid;
begin
  select s.id into secret_id
  from vault.secrets s
  where s.name = 'ollama:' || p_user_id::text
  limit 1;
  if secret_id is null then
    perform vault.create_secret(p_api_key, 'ollama:' || p_user_id::text, 'Ollama API key for Muse user');
  else
    perform vault.update_secret(secret_id, p_api_key, 'ollama:' || p_user_id::text, 'Ollama API key for Muse user');
  end if;
end $$;

create or replace function public.api_key_has(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public, vault as $$
begin
  return exists (select 1 from vault.secrets where name = 'ollama:' || p_user_id::text);
end $$;

create or replace function public.api_key_get(p_user_id uuid)
returns text
language plpgsql security definer set search_path = public, vault as $$
declare result text;
begin
  begin
    select decrypted_secret into result
    from vault.decrypted_secrets
    where name = 'ollama:' || p_user_id::text
    limit 1;
  exception
    when others then
      -- Undecryptable row (e.g. the pgsodium root key was regenerated because
      -- the keyfile in the container filesystem was lost): treat as no key so
      -- the app asks the user to re-enter it instead of failing every request.
      return null;
  end;
  return result;
end $$;

create or replace function public.api_key_delete(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where name = 'ollama:' || p_user_id::text;
end $$;

revoke all on function public.api_key_save(uuid, text) from public;
revoke all on function public.api_key_has(uuid) from public;
revoke all on function public.api_key_get(uuid) from public;
revoke all on function public.api_key_delete(uuid) from public;
-- the Supabase image grants EXECUTE on new functions to anon/authenticated by
-- default, so those explicit grants must be revoked too or any user could
-- read or overwrite another user's key through PostgREST.
revoke all on function public.api_key_save(uuid, text) from anon, authenticated;
revoke all on function public.api_key_has(uuid) from anon, authenticated;
revoke all on function public.api_key_get(uuid) from anon, authenticated;
revoke all on function public.api_key_delete(uuid) from anon, authenticated;
grant execute on function public.api_key_save(uuid, text) to service_role;
grant execute on function public.api_key_has(uuid) to service_role;
grant execute on function public.api_key_get(uuid) to service_role;
grant execute on function public.api_key_delete(uuid) to service_role;
