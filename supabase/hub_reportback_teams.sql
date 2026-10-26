-- Meldmind 0.4.21: report-back and Teams across computers, with no paid hosting.
-- MIGRATION FILE ONLY. NOT RUN. Review it, then run it yourself in the Supabase SQL editor for the
-- project the app already uses. Safe to re-run. The app works without it (report-back falls back to
-- Paste result, Teams stay on one computer) and says "Not switched on yet" until it is run.
--
-- Safety: tables are closed to everyone (RLS on, no policies, no grants). The app reaches them only
-- through the functions below with the publishable key. Each install has a random secret; the cloud
-- keeps only its SHA-256 hash. A job token or an invite code is stored only as a hash too.
-- Rows expire (report-back after 7 days, invites after 14).

create extension if not exists pgcrypto;

-- ---------- report-back ----------
create table if not exists public.rb_jobs (
  job_id      text primary key,
  owner_hash  text not null,
  token_hash  text not null,
  result      jsonb,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days'
);
create index if not exists rb_jobs_owner_idx on public.rb_jobs (owner_hash);
alter table public.rb_jobs enable row level security;
revoke all on table public.rb_jobs from anon, authenticated;

-- The app registers a job and gets a one-time token to give the other AI.
create or replace function public.rb_register(p_owner text, p_job text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if p_owner is null or char_length(p_owner) < 24 or p_job !~ '^[a-z]{1,12}-[A-Za-z0-9_-]{6,64}$' then
    return jsonb_build_object('ok', false, 'message', 'Bad job.');
  end if;
  delete from public.rb_jobs where expires_at < now();
  if (select count(*) from public.rb_jobs where owner_hash = encode(digest(p_owner, 'sha256'), 'hex')) >= 200 then
    return jsonb_build_object('ok', false, 'message', 'Too many open jobs.');
  end if;
  tok := encode(gen_random_bytes(18), 'hex');
  insert into public.rb_jobs (job_id, owner_hash, token_hash)
    values (p_job, encode(digest(p_owner, 'sha256'), 'hex'), encode(digest(tok, 'sha256'), 'hex'))
    on conflict (job_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'message', 'That job already exists.'); end if;
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

-- The other AI reports the result with the job token. One report per job; size limited.
create or replace function public.rb_report(p_job text, p_token text, p_status text, p_summary text, p_links jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.rb_jobs%rowtype;
begin
  select * into r from public.rb_jobs where job_id = p_job and expires_at > now();
  if not found or r.token_hash <> encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false, 'message', 'Job or token not recognised.');
  end if;
  if r.result is not null then return jsonb_build_object('ok', false, 'message', 'Already reported.'); end if;
  if p_status not in ('done', 'failed', 'needs_input') then return jsonb_build_object('ok', false, 'message', 'Status must be done, failed or needs_input.'); end if;
  update public.rb_jobs set result = jsonb_build_object(
      'status', p_status,
      'summary', left(coalesce(p_summary, ''), 8000),
      'links', case when jsonb_typeof(p_links) = 'array' then (select coalesce(jsonb_agg(l), '[]'::jsonb) from (select l from jsonb_array_elements(p_links) l limit 10) s) else '[]'::jsonb end)
    where job_id = p_job;
  return jsonb_build_object('ok', true);
end $$;

-- The app asks for finished jobs that belong to its secret, then confirms each so it is deleted.
create or replace function public.rb_inbox(p_owner text)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('jobId', job_id, 'status', result->>'status', 'summary', result->>'summary', 'links', coalesce(result->'links', '[]'::jsonb)) order by created_at), '[]'::jsonb)
  from public.rb_jobs
  where owner_hash = encode(digest(coalesce(p_owner, ''), 'sha256'), 'hex') and result is not null and expires_at > now();
$$;

create or replace function public.rb_ack(p_owner text, p_job text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.rb_jobs where job_id = p_job and owner_hash = encode(digest(coalesce(p_owner, ''), 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Teams across computers ----------
create table if not exists public.team_spaces (
  ws_id       text primary key,
  owner_hash  text not null,
  name        text not null,
  seat_cap    int not null default 5,
  created_at  timestamptz not null default now()
);
create table if not exists public.team_members (
  ws_id       text not null references public.team_spaces(ws_id) on delete cascade,
  device_hash text not null,
  label       text not null,
  role        text not null default 'member' check (role in ('admin','member','viewer')),
  joined_at   timestamptz not null default now(),
  primary key (ws_id, device_hash)
);
create table if not exists public.team_invites (
  code_hash   text primary key,
  ws_id       text not null references public.team_spaces(ws_id) on delete cascade,
  role        text not null default 'member' check (role in ('admin','member','viewer')),
  expires_at  timestamptz not null default now() + interval '14 days',
  used        boolean not null default false
);
create table if not exists public.team_recipes (
  ws_id       text not null references public.team_spaces(ws_id) on delete cascade,
  recipe_id   text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (ws_id, recipe_id)
);
alter table public.team_spaces enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;
alter table public.team_recipes enable row level security;
revoke all on table public.team_spaces, public.team_members, public.team_invites, public.team_recipes from anon, authenticated;

-- The owner's computer makes the space and an invite code (only the code's hash is stored).
create or replace function public.team_invite_create(p_owner text, p_ws text, p_name text, p_role text, p_code_hash text, p_seat_cap int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare oh text := encode(digest(coalesce(p_owner, ''), 'sha256'), 'hex'); s public.team_spaces%rowtype;
begin
  if char_length(coalesce(p_owner, '')) < 24 or p_ws !~ '^[A-Za-z0-9_-]{4,64}$' or p_code_hash !~ '^[0-9a-f]{64}$' or p_role not in ('admin','member','viewer') then
    return jsonb_build_object('ok', false, 'message', 'Bad invite.');
  end if;
  delete from public.team_invites where expires_at < now();
  select * into s from public.team_spaces where ws_id = p_ws;
  if not found then
    insert into public.team_spaces (ws_id, owner_hash, name, seat_cap) values (p_ws, oh, left(coalesce(p_name, 'Team'), 80), least(greatest(coalesce(p_seat_cap, 5), 1), 5));
  elsif s.owner_hash <> oh then
    return jsonb_build_object('ok', false, 'message', 'This team belongs to another computer.');
  end if;
  insert into public.team_invites (code_hash, ws_id, role) values (p_code_hash, p_ws, p_role) on conflict (code_hash) do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- A second computer enters the code. Seats: the owner counts as one.
create or replace function public.team_invite_accept(p_code text, p_device text, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.team_invites%rowtype; s public.team_spaces%rowtype; dh text := encode(digest(coalesce(p_device, ''), 'sha256'), 'hex'); n int;
begin
  if char_length(coalesce(p_device, '')) < 24 then return jsonb_build_object('ok', false, 'message', 'This install could not be recognised.'); end if;
  select * into i from public.team_invites where code_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex') and expires_at > now() and not used;
  if not found then return jsonb_build_object('ok', false, 'message', 'That invite code is wrong, used, or expired. Ask for a new one.'); end if;
  select * into s from public.team_spaces where ws_id = i.ws_id;
  select count(*) into n from public.team_members where ws_id = i.ws_id and device_hash <> dh;
  if n + 1 >= s.seat_cap then return jsonb_build_object('ok', false, 'message', 'This team is full.'); end if;
  insert into public.team_members (ws_id, device_hash, label, role) values (i.ws_id, dh, left(coalesce(nullif(p_label, ''), 'Teammate'), 60), i.role)
    on conflict (ws_id, device_hash) do update set role = excluded.role;
  update public.team_invites set used = true where code_hash = i.code_hash;
  return jsonb_build_object('ok', true, 'wsId', s.ws_id, 'name', s.name, 'role', i.role);
end $$;

-- Members and shared recipes: readable by the owner's computer and by members' computers.
create or replace function public.team_state(p_device text, p_ws text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare dh text := encode(digest(coalesce(p_device, ''), 'sha256'), 'hex'); s public.team_spaces%rowtype; role text;
begin
  select * into s from public.team_spaces where ws_id = p_ws;
  if not found then return jsonb_build_object('ok', false, 'message', 'No such team.'); end if;
  if s.owner_hash = dh then role := 'owner';
  else select m.role into role from public.team_members m where m.ws_id = p_ws and m.device_hash = dh;
  end if;
  if role is null then return jsonb_build_object('ok', false, 'message', 'You are not in this team.'); end if;
  return jsonb_build_object('ok', true, 'role', role, 'name', s.name, 'seatCap', s.seat_cap,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('label', label, 'role', m.role, 'joinedAt', joined_at)), '[]'::jsonb) from public.team_members m where m.ws_id = p_ws),
    'recipes', (select coalesce(jsonb_agg(data order by updated_at desc), '[]'::jsonb) from public.team_recipes where ws_id = p_ws));
end $$;

-- Owner or admin shares a recipe (steps only, never keys).
create or replace function public.team_recipe_put(p_device text, p_ws text, p_recipe_id text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare dh text := encode(digest(coalesce(p_device, ''), 'sha256'), 'hex'); s public.team_spaces%rowtype; ok boolean;
begin
  select * into s from public.team_spaces where ws_id = p_ws;
  if not found then return jsonb_build_object('ok', false, 'message', 'No such team.'); end if;
  ok := s.owner_hash = dh or exists (select 1 from public.team_members where ws_id = p_ws and device_hash = dh and role = 'admin');
  if not ok then return jsonb_build_object('ok', false, 'message', 'Only the owner or an admin can share a recipe.'); end if;
  if octet_length(p_data::text) > 60000 then return jsonb_build_object('ok', false, 'message', 'That recipe is too big.'); end if;
  insert into public.team_recipes (ws_id, recipe_id, data) values (p_ws, left(p_recipe_id, 64), p_data)
    on conflict (ws_id, recipe_id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.rb_register(text, text), public.rb_report(text, text, text, text, jsonb), public.rb_inbox(text), public.rb_ack(text, text),
  public.team_invite_create(text, text, text, text, text, int), public.team_invite_accept(text, text, text), public.team_state(text, text),
  public.team_recipe_put(text, text, text, jsonb) to anon, authenticated;
