-- Stripe replaces Square (2026-10-25).
-- MIGRATION FILE ONLY. Do not run this from the app or from a build. Chris reviews it, then applies
-- it once (Supabase SQL editor, project everborn-command, or supabase db push) AFTER schema.sql and
-- the earlier migrations. Safe to re-run. There are no paying users and no installs to protect, so
-- Square is dropped in this same file (decision 2026-10-22).
--
-- What this does:
-- 1. stripe_events: one row per Stripe event id, so a replayed event is ignored. No payload is stored.
-- 2. licenses gets stripe_customer_id and stripe_subscription_id. The square_* columns are dropped.
--    licenses.source is stripe, manual or promo (old square rows become stripe).
-- 3. licenses.plan also allows the Developer plans.
-- 4. find_active_license_by_email: service role only, used by the stripe-webhook function.
-- 5. activate_license_by_email: the app calls this with the verified email from the one-click
--    Google or Microsoft sign-in. It returns the tier, status, period end and plan. It never returns
--    the licence key and it does not register a computer (so nobody can fill a customer's computer
--    slots by guessing their email).
-- 6. square_events is dropped. Row level security is on for every new table, service role only.
-- Does not change prices.

-- ---------- 1. Stripe events (idempotency) ----------
create table if not exists public.stripe_events (
  event_id    text primary key,
  type        text,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from public, anon, authenticated;
grant select, insert, update, delete on public.stripe_events to service_role;

-- ---------- 2. licences: Stripe columns in, Square columns out ----------
alter table public.licenses add column if not exists stripe_customer_id text;
alter table public.licenses add column if not exists stripe_subscription_id text;
create unique index if not exists licenses_stripe_subscription_idx on public.licenses (stripe_subscription_id);
create index if not exists licenses_stripe_customer_idx on public.licenses (stripe_customer_id);

alter table public.licenses drop constraint if exists licenses_source_check;
update public.licenses set source = 'stripe' where source = 'square';
alter table public.licenses add constraint licenses_source_check check (source in ('stripe', 'manual', 'promo'));
alter table public.licenses alter column source set default 'stripe';

alter table public.licenses drop column if exists square_customer_id;
alter table public.licenses drop column if exists square_subscription_id;

-- ---------- 3. plans, including Developer ----------
alter table public.licenses drop constraint if exists licenses_plan_check;
alter table public.licenses add constraint licenses_plan_check
  check (plan is null or plan in (
    'pro-monthly',
    'pro-yearly',
    'extreme-monthly',
    'extreme-yearly',
    'developer-monthly',
    'developer-yearly',
    'lifetime-349',
    'lifetime-499'
  ));

-- ---------- 4. find the best active licence on an email (service role only) ----------
create or replace function public.find_active_license_by_email(p_email text)
returns public.licenses
language sql stable security definer set search_path = public as $$
  select l.*
  from public.licenses l
  where lower(l.email) = lower(btrim(coalesce(p_email, '')))
    and l.status = 'active'
    and (l.current_period_end is null or l.current_period_end > now())
  order by
    case l.tier when 'owner' then 4 when 'extreme' then 3 when 'studio' then 2 when 'pro' then 1 else 0 end desc,
    l.current_period_end desc nulls first,
    l.created_at desc
  limit 1
$$;
revoke all on function public.find_active_license_by_email(text) from public, anon, authenticated;
grant execute on function public.find_active_license_by_email(text) to service_role;

-- ---------- 5. the app unlocks by the signed-in email ----------
create or replace function public.activate_license_by_email(p_email text, p_device_id text default null, p_name text default null, p_platform text default null, p_version text default null)
returns table (ok boolean, tier text, status text, email text, period_end timestamptz, devices int, max_devices int, message text, plan text)
language plpgsql security definer set search_path = public as $$
declare l public.licenses%rowtype; v_email text;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 254 then
    return query select false, 'free', 'unknown', null::text, null::timestamptz, 0, 0, 'Sign in with the email you paid with', null::text;
    return;
  end if;
  l := public.find_active_license_by_email(v_email);
  if l.id is null then
    return query select false, 'free', 'unknown', null::text, null::timestamptz, 0, 0, 'No active licence on this email yet', null::text;
    return;
  end if;
  return query select true, l.tier, l.status, l.email, l.current_period_end, 0, coalesce(l.max_devices, 2), 'ok', l.plan;
end $$;
grant execute on function public.activate_license_by_email(text, text, text, text, text) to anon, authenticated;

-- ---------- 6. Square is gone ----------
drop table if exists public.square_events;
