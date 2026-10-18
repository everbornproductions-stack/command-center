-- Everborn Command: hosted-hub tables (run after schema.sql in the Supabase SQL editor).
-- The hub keeps every user's data here instead of the data/ folder. Row Level Security makes
-- each signed-in user see only their own rows; the hub acts with the user's own token.
-- API keys are stored ONLY as AES-256-GCM ciphertext (user_secrets.ciphertext); the master key
-- lives in the hub's environment (CC_MASTER_KEY) and never in the database.

-- ---------- documents: settings, projects, subscriptions, skills, pricing, rules, scheduled, license ----------
create table if not exists public.user_docs (
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind)
);

-- ---------- usage ledger: one row per model call or manual credit entry ----------
create table if not exists public.user_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  ts          timestamptz not null default now(),
  entry       jsonb not null
);
create index if not exists user_ledger_user_ts_idx on public.user_ledger (user_id, ts desc);

-- ---------- missions, councils and single answers (full document + list summary) ----------
create table if not exists public.user_missions (
  user_id     uuid not null references auth.users(id) on delete cascade,
  id          text not null,
  kind        text,
  status      text,
  started_at  timestamptz,
  summary     jsonb,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists user_missions_user_started_idx on public.user_missions (user_id, started_at desc);

-- ---------- encrypted API keys ----------
create table if not exists public.user_secrets (
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider    text not null,
  ciphertext  text not null,          -- base64( iv | gcm tag | ciphertext ), AAD = user_id:provider
  key_version int not null default 1, -- bump when CC_MASTER_KEY is rotated
  updated_at  timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ---------- RLS: owner only, on every table ----------
alter table public.user_docs     enable row level security;
alter table public.user_ledger   enable row level security;
alter table public.user_missions enable row level security;
alter table public.user_secrets  enable row level security;

drop policy if exists "own docs" on public.user_docs;
create policy "own docs" on public.user_docs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own ledger" on public.user_ledger;
create policy "own ledger" on public.user_ledger for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own missions" on public.user_missions;
create policy "own missions" on public.user_missions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own secrets" on public.user_secrets;
create policy "own secrets" on public.user_secrets for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- anon (not signed in) gets nothing on these tables
revoke all on public.user_docs, public.user_ledger, public.user_missions, public.user_secrets from anon;
