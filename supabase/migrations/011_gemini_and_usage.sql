-- 011: Gemini API keys and AI usage logging
-- Stores Gemini API keys encrypted in Supabase Vault under 'gemini:<user_id>'
-- Records token usage per request for free-tier quota tracking and analytics.

create or replace function public.gemini_api_key_save(p_user_id uuid, p_api_key text)
returns void
language plpgsql security definer set search_path = public, vault as $$
declare secret_id uuid;
begin
  select s.id into secret_id
  from vault.secrets s
  where s.name = 'gemini:' || p_user_id::text
  limit 1;
  if secret_id is null then
    perform vault.create_secret(p_api_key, 'gemini:' || p_user_id::text, 'Gemini API key for Muse user');
  else
    perform vault.update_secret(secret_id, p_api_key, 'gemini:' || p_user_id::text, 'Gemini API key for Muse user');
  end if;
end $$;

create or replace function public.gemini_api_key_has(p_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public, vault as $$
begin
  return exists (select 1 from vault.secrets where name = 'gemini:' || p_user_id::text);
end $$;

create or replace function public.gemini_api_key_get(p_user_id uuid)
returns text
language plpgsql security definer set search_path = public, vault as $$
declare result text;
begin
  begin
    select decrypted_secret into result
    from vault.decrypted_secrets
    where name = 'gemini:' || p_user_id::text
    limit 1;
  exception
    when others then
      return null;
  end;
  return result;
end $$;

create or replace function public.gemini_api_key_delete(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public, vault as $$
begin
  delete from vault.secrets where name = 'gemini:' || p_user_id::text;
end $$;

revoke all on function public.gemini_api_key_save(uuid, text) from public, anon, authenticated;
revoke all on function public.gemini_api_key_has(uuid) from public, anon, authenticated;
revoke all on function public.gemini_api_key_get(uuid) from public, anon, authenticated;
revoke all on function public.gemini_api_key_delete(uuid) from public, anon, authenticated;

grant execute on function public.gemini_api_key_save(uuid, text) to service_role;
grant execute on function public.gemini_api_key_has(uuid) to service_role;
grant execute on function public.gemini_api_key_get(uuid) to service_role;
grant execute on function public.gemini_api_key_delete(uuid) to service_role;

-- AI Usage logging table for token and quota tracking
create table if not exists public.ai_usage_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null,
  provider text not null default 'gemini',
  model text not null,
  task_type text not null default 'general',
  prompt_tokens integer not null default 0,
  candidate_tokens integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_ai_usage_user_created on public.ai_usage_logs(user_id, created_at desc);

-- RPC to retrieve daily token usage and request counts for quota visualization
create or replace function public.get_ai_daily_usage(p_user_id uuid, p_provider text default 'gemini')
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'UTC');
  v_req_count integer := 0;
  v_prompt_tokens bigint := 0;
  v_candidate_tokens bigint := 0;
  v_total_tokens bigint := 0;
  v_models_json json;
begin
  select
    coalesce(count(*), 0),
    coalesce(sum(prompt_tokens), 0),
    coalesce(sum(candidate_tokens), 0),
    coalesce(sum(total_tokens), 0)
  into v_req_count, v_prompt_tokens, v_candidate_tokens, v_total_tokens
  from public.ai_usage_logs
  where user_id = p_user_id
    and provider = p_provider
    and created_at >= v_today_start;

  select coalesce(json_agg(row_to_json(m)), '[]'::json)
  into v_models_json
  from (
    select
      model as name,
      count(*)::integer as requests,
      coalesce(sum(total_tokens), 0)::bigint as tokens
    from public.ai_usage_logs
    where user_id = p_user_id
      and provider = p_provider
      and created_at >= v_today_start
    group by model
    order by requests desc
  ) m;

  return json_build_object(
    'provider', p_provider,
    'requestsToday', v_req_count,
    'dailyLimit', 1500,
    'promptTokens', v_prompt_tokens,
    'candidateTokens', v_candidate_tokens,
    'totalTokens', v_total_tokens,
    'models', v_models_json,
    'resetUtc', (v_today_start + interval '1 day')
  );
end $$;

grant execute on function public.get_ai_daily_usage(uuid, text) to service_role;
