-- Everborn Command: Team SSO rule per workspace (Phase 24). Run after workspaces.sql.
-- MIGRATION FILE ONLY: review it, then run it yourself in the Supabase SQL editor. Safe to re-run.
-- Sign-in itself uses Supabase Auth's Google and Azure (Microsoft) providers: turn them on in the Supabase
-- dashboard (Authentication > Providers, with your own client id and secret there), add the hub address to
-- the redirect allow list, then set CC_SSO_PROVIDERS=google,azure on the hub.
-- This table only holds each workspace's rule: "members and viewers sign in with these providers, with an
-- address on these domains". The hub enforces it (server/sso.js); the owner is never locked out.
-- Everyone in the workspace reads the rule; owner and admin set it.

create table if not exists public.workspace_sso (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  required     boolean not null default false,
  providers    text[] not null default '{}' check (providers <@ array['google','azure']::text[]),
  domains      text[] not null default '{}' check (cardinality(domains) <= 20),
  updated_by   uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table public.workspace_sso enable row level security;

drop policy if exists workspace_sso_read on public.workspace_sso;
create policy workspace_sso_read on public.workspace_sso for select
  using (public.ws_role(workspace_id) is not null);

drop policy if exists workspace_sso_insert on public.workspace_sso;
create policy workspace_sso_insert on public.workspace_sso for insert
  with check (public.ws_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_sso_update on public.workspace_sso;
create policy workspace_sso_update on public.workspace_sso for update
  using (public.ws_role(workspace_id) in ('owner','admin'))
  with check (public.ws_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_sso_delete on public.workspace_sso;
create policy workspace_sso_delete on public.workspace_sso for delete
  using (public.ws_role(workspace_id) in ('owner','admin'));

grant select, insert, update, delete on public.workspace_sso to authenticated;
