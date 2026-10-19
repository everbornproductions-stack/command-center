-- Everborn Command: per-workspace API keys (Phase 24). Run after workspaces.sql.
-- MIGRATION FILE ONLY: review it, then run it yourself in the Supabase SQL editor. Safe to re-run.
-- One row per workspace and provider. ciphertext is AES-256-GCM under the hub's master key (CC_MASTER_KEY),
-- bound to "ws:<workspace id>:<provider>", so only the hub can open it and a row copied to another workspace
-- does not open. The key itself is never stored in the clear; masked is its first and last four characters.
-- Roles (same as server/workspace-keys.js):
--   owner, admin and member read the rows (the hub opens them for calls made while the workspace is active);
--   a viewer does not (viewers use their own keys);
--   owner and admin add, replace and remove keys.

create table if not exists public.workspace_secrets (
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  provider       text not null check (provider ~ '^[a-z0-9-]{2,40}$'),
  ciphertext     text not null,
  masked         text,
  added_by       uuid default auth.uid() references auth.users(id) on delete set null,
  added_by_email text,
  updated_at     timestamptz not null default now(),
  primary key (workspace_id, provider)
);

alter table public.workspace_secrets enable row level security;

drop policy if exists workspace_secrets_read on public.workspace_secrets;
create policy workspace_secrets_read on public.workspace_secrets for select
  using (public.ws_role(workspace_id) in ('owner','admin','member'));

drop policy if exists workspace_secrets_insert on public.workspace_secrets;
create policy workspace_secrets_insert on public.workspace_secrets for insert
  with check (public.ws_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_secrets_update on public.workspace_secrets;
create policy workspace_secrets_update on public.workspace_secrets for update
  using (public.ws_role(workspace_id) in ('owner','admin'))
  with check (public.ws_role(workspace_id) in ('owner','admin'));

drop policy if exists workspace_secrets_delete on public.workspace_secrets;
create policy workspace_secrets_delete on public.workspace_secrets for delete
  using (public.ws_role(workspace_id) in ('owner','admin'));

grant select, insert, update, delete on public.workspace_secrets to authenticated;
