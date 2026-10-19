-- Everborn Command: custom agents and saved prompts shared with a workspace (Phase 19). Run after workspaces.sql.
-- MIGRATION FILE ONLY: review it, then run it yourself in the Supabase SQL editor. Safe to re-run.
-- Each person's own agents and prompts live in user_docs (kinds "agents.custom" and "agents.prompts").
-- This table holds the snapshots someone shared into a workspace. Agents and prompts are text only:
-- no keys, tokens or secrets are ever in them.
-- Roles (same as server/custom-agents.js SHARE_PERMISSIONS):
--   everyone in the workspace (viewer too) reads;
--   owner, admin and member share their own items and update or remove what they shared;
--   owner and admin update or remove anything shared there;
--   a viewer can only look (the server also refuses a viewer's run and copy).

create table if not exists public.workspace_agents (
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  kind            text not null check (kind in ('agent','prompt')),
  item_id         text not null,
  shared_by       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shared_by_email text,
  data            jsonb not null,
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, kind, item_id)
);
create index if not exists workspace_agents_ws_idx on public.workspace_agents (workspace_id);

alter table public.workspace_agents enable row level security;

drop policy if exists workspace_agents_read on public.workspace_agents;
create policy workspace_agents_read on public.workspace_agents for select
  using (public.ws_role(workspace_id) is not null);

drop policy if exists workspace_agents_insert on public.workspace_agents;
create policy workspace_agents_insert on public.workspace_agents for insert
  with check (shared_by = auth.uid() and public.ws_role(workspace_id) in ('owner','admin','member'));

drop policy if exists workspace_agents_update on public.workspace_agents;
create policy workspace_agents_update on public.workspace_agents for update
  using ((shared_by = auth.uid() and public.ws_role(workspace_id) in ('owner','admin','member')) or public.ws_role(workspace_id) in ('owner','admin'))
  with check (public.ws_role(workspace_id) in ('owner','admin','member'));

drop policy if exists workspace_agents_delete on public.workspace_agents;
create policy workspace_agents_delete on public.workspace_agents for delete
  using ((shared_by = auth.uid() and public.ws_role(workspace_id) in ('owner','admin','member')) or public.ws_role(workspace_id) in ('owner','admin'));

-- the server asks for the caller's role through this function (already created by workspaces.sql)
grant execute on function public.ws_role(uuid) to authenticated;
