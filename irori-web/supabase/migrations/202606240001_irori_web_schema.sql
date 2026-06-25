create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault" with schema vault;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'General',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default 'New chat',
  mode text not null default 'quick' check (mode in ('quick', 'standard', 'deep')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text,
  model_display_name text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric not null default 0,
  actual_cost numeric not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.model_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('quick', 'standard', 'deep')),
  provider text not null check (provider in ('openrouter', 'sakana', 'openai', 'anthropic', 'google', 'local')),
  display_name text not null,
  model_slug text not null,
  input_price_per_million_tokens numeric not null default 0,
  output_price_per_million_tokens numeric not null default 0,
  context_window integer not null default 128000,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, mode)
);

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  model text not null,
  mode text not null check (mode in ('quick', 'standard', 'deep')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric not null default 0,
  actual_cost numeric not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  quick_model_slug text not null default 'deepseek/deepseek-v4-flash',
  standard_model_slug text not null default 'deepseek/deepseek-v4-pro',
  deep_model_slug text not null default 'fugu',
  monthly_budget_jpy integer not null default 3000,
  jpy_per_usd numeric not null default 150,
  deep_confirmation_enabled boolean not null default true,
  per_run_cost_limit numeric not null default 0.5,
  has_openrouter_key boolean not null default false,
  has_fugu_key boolean not null default false,
  has_tavily_key boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.api_key_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('openrouter', 'fugu', 'tavily')),
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind)
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.model_configs enable row level security;
alter table public.usage_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.api_key_secrets enable row level security;

create policy "profiles own rows" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "projects own rows" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "conversations own rows" on public.conversations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "messages own rows" on public.messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "model_configs own rows" on public.model_configs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "usage_logs own rows" on public.usage_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "app_settings own rows" on public.app_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "api_key_secrets own rows" on public.api_key_secrets for select using (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch_updated_at before update on public.projects for each row execute function public.touch_updated_at();
create trigger conversations_touch_updated_at before update on public.conversations for each row execute function public.touch_updated_at();
create trigger model_configs_touch_updated_at before update on public.model_configs for each row execute function public.touch_updated_at();
create trigger app_settings_touch_updated_at before update on public.app_settings for each row execute function public.touch_updated_at();
create trigger api_key_secrets_touch_updated_at before update on public.api_key_secrets for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.app_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.projects (user_id, name)
  values (new.id, 'General')
  on conflict do nothing;

  insert into public.model_configs (user_id, mode, provider, display_name, model_slug, input_price_per_million_tokens, output_price_per_million_tokens, context_window)
  values
    (new.id, 'quick', 'openrouter', 'DeepSeek V4 Flash', 'deepseek/deepseek-v4-flash', 0.09, 0.18, 1048576),
    (new.id, 'standard', 'openrouter', 'DeepSeek V4 Pro', 'deepseek/deepseek-v4-pro', 0.435, 0.87, 1048576),
    (new.id, 'deep', 'sakana', 'Fugu', 'fugu', 4, 12, 128000)
  on conflict (user_id, mode) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.save_user_api_key(p_user_id uuid, p_kind text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  if p_kind not in ('openrouter', 'fugu', 'tavily') then
    raise exception 'unsupported api key kind';
  end if;

  select vault.create_secret(p_secret, 'irori_' || p_kind || '_' || p_user_id::text, 'Irori ' || p_kind || ' API key') into v_secret_id;

  insert into public.api_key_secrets (user_id, kind, vault_secret_id)
  values (p_user_id, p_kind, v_secret_id)
  on conflict (user_id, kind)
  do update set vault_secret_id = excluded.vault_secret_id, updated_at = now();

  update public.app_settings
  set
    has_openrouter_key = case when p_kind = 'openrouter' then true else has_openrouter_key end,
    has_fugu_key = case when p_kind = 'fugu' then true else has_fugu_key end,
    has_tavily_key = case when p_kind = 'tavily' then true else has_tavily_key end,
    updated_at = now()
  where user_id = p_user_id;
end;
$$;

create or replace function public.get_user_api_key(p_user_id uuid, p_kind text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where id = (
    select vault_secret_id
    from public.api_key_secrets
    where user_id = p_user_id and kind = p_kind
  )
  limit 1;
$$;

revoke all on function public.save_user_api_key(uuid, text, text) from anon, authenticated;
revoke all on function public.get_user_api_key(uuid, text) from anon, authenticated;
grant execute on function public.save_user_api_key(uuid, text, text) to service_role;
grant execute on function public.get_user_api_key(uuid, text) to service_role;
