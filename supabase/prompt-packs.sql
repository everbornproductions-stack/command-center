-- Meldmind: prompt votes and weekly prompt packs.
-- MIGRATION FILE ONLY. Review it, then run it yourself in the Supabase SQL editor. Safe to re-run.
-- The app does not run this file. Votes are one per person per prompt and can be changed.
-- Weekly packs are a public catalog (no secrets) so a new pack can show up without an app update.
-- When the table cannot be reached, the app keeps the vote on this computer.

create table if not exists public.prompt_votes (
  user_id    uuid not null references auth.users(id) on delete cascade,
  prompt_id  text not null,
  vote       smallint not null check (vote in (1, -1)),
  updated_at timestamptz not null default now(),
  primary key (user_id, prompt_id)
);

alter table public.prompt_votes enable row level security;

drop policy if exists prompt_votes_select on public.prompt_votes;
create policy prompt_votes_select on public.prompt_votes
  for select using (auth.uid() = user_id);

drop policy if exists prompt_votes_insert on public.prompt_votes;
create policy prompt_votes_insert on public.prompt_votes
  for insert with check (auth.uid() = user_id);

drop policy if exists prompt_votes_update on public.prompt_votes;
create policy prompt_votes_update on public.prompt_votes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists prompt_votes_delete on public.prompt_votes;
create policy prompt_votes_delete on public.prompt_votes
  for delete using (auth.uid() = user_id);

-- Counts only. No names and no user ids.
create or replace function public.prompt_vote_totals()
returns table (prompt_id text, up_count bigint, down_count bigint)
language sql
security definer
set search_path = public
as $$
  select prompt_id,
    count(*) filter (where vote = 1) as up_count,
    count(*) filter (where vote = -1) as down_count
  from public.prompt_votes
  group by prompt_id;
$$;

revoke all on function public.prompt_vote_totals() from public;
grant execute on function public.prompt_vote_totals() to anon, authenticated;

create table if not exists public.prompt_packs (
  id              text primary key,
  title           text not null,
  category        text not null,
  industry        text,
  prompt          text not null,
  source_name     text,
  source_url      text,
  popularity_note text,
  added_week      text not null,
  builder         text,
  feature         text,
  updated_at      timestamptz not null default now()
);

alter table public.prompt_packs enable row level security;

drop policy if exists prompt_packs_read on public.prompt_packs;
create policy prompt_packs_read on public.prompt_packs
  for select to anon, authenticated
  using (true);

-- Inserts and edits are for the service role in the SQL editor. There is no write policy for app users.
