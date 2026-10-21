-- Anonymous usage pings (one row per install per UTC day).
-- Migration file only. Do not run this from the app or from a deploy. Apply it by hand in the
-- Supabase SQL editor after review. It has not been run on any database.
--
-- The desktop app does not write this table. It POSTs the ping to the hub. The hub calls
-- record_usage_ping with the service key, which stays on the server.
-- Row level security: anon and authenticated may INSERT a valid row and may call the function.
-- They have no select, update, or delete. The owner report reads with the service key.

create table if not exists public.usage_pings (
  install_id text not null check (install_id ~ '^[a-f0-9]{32}$'),
  day date not null,
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$' and char_length(version) <= 32),
  os text not null check (os in ('win32', 'darwin', 'linux', 'web', 'other')),
  tier text not null check (tier in ('free', 'pro', 'studio', 'extreme', 'owner')),
  features jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (install_id, day)
);

create index if not exists usage_pings_day_idx on public.usage_pings (day);

alter table public.usage_pings enable row level security;

revoke all on table public.usage_pings from public, anon, authenticated;
grant insert on table public.usage_pings to anon, authenticated;

drop policy if exists usage_pings_insert on public.usage_pings;
create policy usage_pings_insert on public.usage_pings
  for insert
  to anon, authenticated
  with check (
    install_id ~ '^[a-f0-9]{32}$'
    and os in ('win32', 'darwin', 'linux', 'web', 'other')
    and tier in ('free', 'pro', 'studio', 'extreme', 'owner')
    and version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
    and jsonb_typeof(features) = 'object'
  );

-- No select, update, or delete policy. Those roles cannot read the table.

create or replace function public.record_usage_ping(
  p_install_id text,
  p_day date,
  p_version text,
  p_os text,
  p_tier text,
  p_features jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_install_id is null or p_install_id !~ '^[a-f0-9]{32}$' then
    raise exception 'usage ping refused';
  end if;
  if p_version is null or p_version !~ '^[0-9]+\.[0-9]+\.[0-9]+$' or char_length(p_version) > 32 then
    raise exception 'usage ping refused';
  end if;
  if p_os not in ('win32', 'darwin', 'linux', 'web', 'other') then
    raise exception 'usage ping refused';
  end if;
  if p_tier not in ('free', 'pro', 'studio', 'extreme', 'owner') then
    raise exception 'usage ping refused';
  end if;
  if p_day is null
     or p_day < (timezone('utc', now()))::date - 1
     or p_day > (timezone('utc', now()))::date then
    raise exception 'usage ping refused';
  end if;
  if p_features is null or jsonb_typeof(p_features) <> 'object' then
    raise exception 'usage ping refused';
  end if;
  if exists (
    select 1 from jsonb_each(p_features) e
    where e.key !~ '^[a-z][a-z0-9]{0,23}$'
       or e.key in ('email', 'prompt', 'content', 'file', 'files', 'key', 'name', 'text', 'message', 'secret', 'token', 'chat')
       or jsonb_typeof(e.value) <> 'number'
       or (e.value #>> '{}') !~ '^[0-9]+$'
       or (e.value #>> '{}')::int < 1
       or (e.value #>> '{}')::int > 100000
  ) then
    raise exception 'usage ping refused';
  end if;
  insert into public.usage_pings (install_id, day, version, os, tier, features)
  values (p_install_id, p_day, p_version, p_os, p_tier, p_features)
  on conflict (install_id, day) do update
    set version = excluded.version,
        os = excluded.os,
        tier = excluded.tier,
        features = excluded.features,
        updated_at = now();
end;
$$;

revoke all on function public.record_usage_ping(text, date, text, text, text, jsonb) from public;
grant execute on function public.record_usage_ping(text, date, text, text, text, jsonb) to anon, authenticated, service_role;
