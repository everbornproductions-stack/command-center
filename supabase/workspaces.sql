-- Everborn Command: teams and shared workspaces (Studio tier, Phase 8). Run after schema.sql and hosted.sql.
-- MIGRATION FILE ONLY: review it, then run it yourself in the Supabase SQL editor. Safe to re-run.
-- An owner creates a workspace, invites members by email, and shares chosen projects into it.
-- A member who signs in to the hub with an invited email sees those projects (and nothing else of
-- the owner's). The owner sees each member's AI usage (calls and cost) per month.
-- RLS: owners manage everything in their workspaces; members read what is shared with them.

create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists workspaces_owner_idx on public.workspaces (owner_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,                       -- lower-cased invite address
  user_id      uuid references auth.users(id) on delete set null,  -- filled when that email signs in
  role         text not null default 'member',        -- admin | member | viewer (the owner is workspaces.owner_id)
  status       text not null default 'invited' check (status in ('invited','active')),
  invited_at   timestamptz not null default now(),
  joined_at    timestamptz,
  primary key (workspace_id, email)
);
create index if not exists workspace_members_email_idx on public.workspace_members (lower(email));
-- Phase 8: roles and invite links (works on a fresh database and on one where the first version ran)
alter table public.workspace_members add column if not exists invite_hash text;          -- sha256 of the invite code; the code itself is never stored
alter table public.workspace_members add column if not exists expires_at  timestamptz;
alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('admin','member','viewer'));
create index if not exists workspace_members_hash_idx on public.workspace_members (invite_hash);

create table if not exists public.workspace_projects (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id   text not null,
  data         jsonb not null,                      -- snapshot of the shared project (name, colour, categories, links)
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, project_id)
);

create table if not exists public.workspace_usage (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  email        text,
  month        text not null,                       -- 'YYYY-MM' (UTC)
  calls        int not null default 0,
  cost         numeric(12,6) not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, user_id, month)
);

-- ---------- helpers (security definer so policies do not recurse into each other) ----------
create or replace function public.ws_is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = auth.uid())
$$;
create or replace function public.ws_is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.status = 'active'
      and (m.user_id = auth.uid() or lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  )
$$;

-- my role in a workspace: 'owner' | 'admin' | 'member' | 'viewer' | null
create or replace function public.ws_role(ws uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = auth.uid()) then 'owner'
    else (select m.role from public.workspace_members m
          where m.workspace_id = ws and m.status = 'active'
            and (m.user_id = auth.uid() or lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', '')))
          limit 1)
  end
$$;
create or replace function public.ws_can_manage(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ws_role(ws) in ('owner','admin'), false)
$$;

-- Accept an invite link: the code hash must match an open invite for the signed-in email and not be expired.
-- Runs as definer so invitees never get a general UPDATE right on member rows (they cannot change their role).
create or replace function public.ws_accept_invite(p_hash text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_exp timestamptz;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  select workspace_id, expires_at into v_ws, v_exp from public.workspace_members
    where invite_hash = p_hash and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1;
  if v_ws is null then raise exception 'invite not found for this email'; end if;
  if v_exp is not null and v_exp < now() then raise exception 'invite expired'; end if;
  update public.workspace_members set user_id = auth.uid(), status = 'active', joined_at = coalesce(joined_at, now()), invite_hash = null
    where workspace_id = v_ws and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
  return v_ws;
end $$;
grant execute on function public.ws_accept_invite(text) to authenticated;

-- On sign-in the hub also activates open, unexpired invites addressed to the signed-in email.
create or replace function public.ws_join_by_email() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return 0; end if;
  update public.workspace_members set user_id = auth.uid(), status = 'active', joined_at = coalesce(joined_at, now()), invite_hash = null
    where user_id is null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (expires_at is null or expires_at > now());
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.ws_join_by_email() to authenticated;

-- Usage roll-up the hub calls after each model call (atomic increment). Viewers are not counted.
create or replace function public.ws_add_usage(p_ws uuid, p_month text, p_calls int, p_cost numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if coalesce(public.ws_role(p_ws), 'viewer') = 'viewer' then raise exception 'not a counting member of this workspace'; end if;
  insert into public.workspace_usage (workspace_id, user_id, email, month, calls, cost)
    values (p_ws, auth.uid(), lower(coalesce(auth.jwt() ->> 'email', '')), p_month, greatest(p_calls, 0), greatest(p_cost, 0))
  on conflict (workspace_id, user_id, month) do update
    set calls = public.workspace_usage.calls + excluded.calls,
        cost  = public.workspace_usage.cost + excluded.cost,
        email = coalesce(excluded.email, public.workspace_usage.email),
        updated_at = now();
end $$;
grant execute on function public.ws_add_usage(uuid, text, int, numeric) to authenticated;

-- ---------- RLS ----------
alter table public.workspaces         enable row level security;
alter table public.workspace_members  enable row level security;
alter table public.workspace_projects enable row level security;
alter table public.workspace_usage    enable row level security;

drop policy if exists "ws read" on public.workspaces;
create policy "ws read" on public.workspaces for select to authenticated using (owner_id = auth.uid() or public.ws_is_member(id));
drop policy if exists "ws insert" on public.workspaces;
create policy "ws insert" on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "ws update" on public.workspaces;
create policy "ws update" on public.workspaces for update to authenticated using (public.ws_can_manage(id)) with check (public.ws_can_manage(id));
drop policy if exists "ws delete" on public.workspaces;
create policy "ws delete" on public.workspaces for delete to authenticated using (owner_id = auth.uid());

-- members: the owner manages everyone; an admin manages members and viewers only; invitees read their own
-- row and join only through ws_accept_invite / ws_join_by_email (no direct UPDATE, so no self-promotion)
drop policy if exists "wsm read" on public.workspace_members;
create policy "wsm read" on public.workspace_members for select to authenticated
  using (public.ws_is_owner(workspace_id) or public.ws_is_member(workspace_id) or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
drop policy if exists "wsm insert" on public.workspace_members;
create policy "wsm insert" on public.workspace_members for insert to authenticated
  with check (public.ws_is_owner(workspace_id) or (public.ws_role(workspace_id) = 'admin' and role in ('member','viewer')));
drop policy if exists "wsm delete" on public.workspace_members;
create policy "wsm delete" on public.workspace_members for delete to authenticated
  using (public.ws_is_owner(workspace_id) or (public.ws_role(workspace_id) = 'admin' and role in ('member','viewer')));
drop policy if exists "wsm update" on public.workspace_members;
create policy "wsm update" on public.workspace_members for update to authenticated
  using (public.ws_is_owner(workspace_id) or (public.ws_role(workspace_id) = 'admin' and role in ('member','viewer')))
  with check (public.ws_is_owner(workspace_id) or (public.ws_role(workspace_id) = 'admin' and role in ('member','viewer')));

drop policy if exists "wsp read" on public.workspace_projects;
create policy "wsp read" on public.workspace_projects for select to authenticated using (public.ws_is_owner(workspace_id) or public.ws_is_member(workspace_id));
drop policy if exists "wsp write" on public.workspace_projects;
create policy "wsp write" on public.workspace_projects for all to authenticated using (public.ws_can_manage(workspace_id)) with check (public.ws_can_manage(workspace_id));

-- usage: owner and admins see everyone's; others see only their own; writes go through ws_add_usage()
drop policy if exists "wsu read" on public.workspace_usage;
create policy "wsu read" on public.workspace_usage for select to authenticated using (public.ws_can_manage(workspace_id) or user_id = auth.uid());

revoke all on public.workspaces, public.workspace_members, public.workspace_projects, public.workspace_usage from anon;
