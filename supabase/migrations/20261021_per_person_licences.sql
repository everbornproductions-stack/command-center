-- Per-person licences (2026-10-21).
-- MIGRATION FILE ONLY. Do not run this from the app. Chris reviews it, then runs it
-- once in the Supabase SQL editor (project everborn-command) AFTER schema.sql and
-- supabase/migrations/20261018_license_pending.sql. Safe to re-run.
--
-- Does not change Square, billing, or prices.
--
-- What this approves:
-- 1. licenses.max_devices defaults to 2 (a PC and a laptop). Rows still on the old
--    default of 3 are set to 2. Any other number is left as it is.
-- 2. verify_license refuses a NEW computer past that cap and does not record it.
--    Computers already on the key keep working until they are removed.
--    The refusal says: This key is already on 2 computers. Remove one in Settings > Devices.
-- 3. The person who holds the key can list and remove a computer
--    (list_license_devices, remove_license_device).
-- 4. promo_codes.email, when set, redeems only for that email. Empty means any email.
-- 5. create_tester_code is service-role only. scripts/make-tester-code.mjs calls it.
-- 6. A licence used from 4 or more different computers, or 4 or more different
--    IP addresses, in 24 hours is written to license_reviews for the owner to review.
--    The flag does not block the person. An Extreme team seat is its own licence
--    (its own email and its own max_devices). Computers are counted per person,
--    never pooled across the team.

-- ---------- cap: 2 computers per person ----------
alter table public.licenses alter column max_devices set default 2;
alter table public.licenses drop constraint if exists licenses_max_devices_check;
alter table public.licenses add constraint licenses_max_devices_check check (max_devices >= 1);

-- Old default was 3. A person now gets 2. Hand-set values other than 3 stay put.
update public.licenses set max_devices = 2 where max_devices = 3;

comment on column public.licenses.max_devices is
  'Active computers for this one person. Default 2: a PC and a laptop. An Extreme team seat is a separate licence, so each member has their own cap. Devices are never pooled across members.';

-- ---------- one email on a promo or tester code (null = not locked) ----------
alter table public.promo_codes add column if not exists email text;
create index if not exists promo_codes_email_idx on public.promo_codes (lower(email));
comment on column public.promo_codes.email is
  'When set, redeem_promo accepts only this email. Null means any email (existing shared codes).';

-- ---------- computers on a key ----------
alter table public.devices add column if not exists removed_at timestamptz;
alter table public.devices add column if not exists seat_email text;
update public.devices d
  set seat_email = lower(l.email)
  from public.licenses l
  where d.license_id = l.id and (d.seat_email is null or btrim(d.seat_email) = '');
create index if not exists devices_active_seat_idx on public.devices (license_id, seat_email) where removed_at is null;
comment on column public.devices.seat_email is
  'The person this computer counts against. Always the licence email. Extreme team seats are separate licences, so they never share this count.';

-- Attempts, including a computer that was refused. Owner review only (no customer policy).
create table if not exists public.license_signals (
  id          bigint generated always as identity primary key,
  license_id  uuid not null references public.licenses(id) on delete cascade,
  device_id   text not null,
  ip          text,
  seen_at     timestamptz not null default now()
);
create index if not exists license_signals_recent_idx on public.license_signals (license_id, seen_at desc);

-- One row when a licence is used from many computers or addresses in a short time.
create table if not exists public.license_reviews (
  license_id        uuid primary key references public.licenses(id) on delete cascade,
  reason            text not null,
  flagged_at        timestamptz not null default now(),
  distinct_devices  int not null default 0,
  distinct_ips      int not null default 0,
  window_hours      int not null default 24
);

alter table public.license_signals enable row level security;
alter table public.license_reviews enable row level security;
revoke all on public.license_signals from public, anon, authenticated;
revoke all on public.license_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.license_signals to service_role;
grant select, insert, update, delete on public.license_reviews to service_role;

-- First address from the request, when Supabase passes it. Never required for the check to succeed.
create or replace function public.license_client_ip() returns text
language plpgsql stable set search_path = public as $$
declare raw text; first text;
begin
  raw := current_setting('request.headers', true);
  if raw is null or btrim(raw) = '' then return null; end if;
  first := nullif(btrim(split_part(coalesce(raw::json->>'x-forwarded-for', ''), ',', 1)), '');
  if first is null then first := nullif(btrim(coalesce(raw::json->>'x-real-ip', '')), ''); end if;
  if first is null or length(first) > 64 then return null; end if;
  if first !~ '^[0-9A-Fa-f:.]+$' then return null; end if;
  return first;
exception when others then
  return null;
end $$;
revoke all on function public.license_client_ip() from public, anon, authenticated;

-- The app calls this with the anon key. A new computer past max_devices is not stored.
create or replace function public.verify_license(p_key text, p_device_id text, p_name text default null, p_platform text default null, p_version text default null)
returns table (ok boolean, tier text, status text, email text, period_end timestamptz, devices int, max_devices int, message text)
language plpgsql security definer set search_path = public as $$
declare
  l public.licenses%rowtype;
  n int;
  v_device text;
  v_ip text;
  v_cap int;
  v_devs int;
  v_ips int;
  v_msg text;
  v_updated int;
begin
  v_device := left(nullif(btrim(coalesce(p_device_id, '')), ''), 128);
  if v_device is null then
    return query select false, 'free', 'unknown', null::text, null::timestamptz, 0, 0, 'This computer has no device id';
    return;
  end if;

  select * into l from public.licenses where key = upper(btrim(p_key));
  if not found then
    return query select false, 'free', 'unknown', null::text, null::timestamptz, 0, 0, 'Licence key not found';
    return;
  end if;

  -- One person, one cap. Do not join devices from any other licence (that is how an
  -- Extreme team seat stays separate: each member has their own licence row).
  perform pg_advisory_xact_lock(hashtext(l.id::text));
  v_cap := greatest(coalesce(l.max_devices, 2), 1);
  v_ip := public.license_client_ip();

  insert into public.license_signals (license_id, device_id, ip)
  values (l.id, v_device, v_ip);
  delete from public.license_signals s
    where s.license_id = l.id and s.seen_at < now() - interval '7 days';

  -- 4 different computers, or 4 different addresses, in 24 hours: flag for the owner.
  -- The person is not blocked by this. A PC and a laptop is 2, which does not flag.
  select count(distinct s.device_id), count(distinct s.ip) filter (where s.ip is not null and btrim(s.ip) <> '')
    into v_devs, v_ips
  from public.license_signals s
  where s.license_id = l.id and s.seen_at > now() - interval '24 hours';

  if v_devs >= 4 or v_ips >= 4 then
    insert into public.license_reviews (license_id, reason, distinct_devices, distinct_ips, window_hours)
    values (
      l.id,
      case
        when v_devs >= 4 then v_devs::text || ' computers in 24 hours'
        else v_ips::text || ' networks in 24 hours'
      end,
      v_devs,
      v_ips,
      24
    )
    on conflict (license_id) do update
      set distinct_devices = greatest(public.license_reviews.distinct_devices, excluded.distinct_devices),
          distinct_ips = greatest(public.license_reviews.distinct_ips, excluded.distinct_ips);
  end if;

  if l.status <> 'active' then
    return query select false, 'free', l.status, l.email, l.current_period_end, 0, v_cap, 'Licence is ' || l.status;
    return;
  end if;

  if exists (
    select 1 from public.devices d
    where d.license_id = l.id
      and d.device_id = v_device
      and d.removed_at is null
      and lower(coalesce(d.seat_email, l.email)) = lower(l.email)
  ) then
    update public.devices d
      set last_seen = now(),
          name = coalesce(nullif(btrim(p_name), ''), d.name),
          platform = coalesce(nullif(btrim(p_platform), ''), d.platform),
          app_version = coalesce(nullif(btrim(p_version), ''), d.app_version),
          seat_email = lower(l.email)
      where d.license_id = l.id and d.device_id = v_device and d.removed_at is null;
  else
    select count(*) into n from public.devices d
      where d.license_id = l.id
        and d.removed_at is null
        and lower(coalesce(d.seat_email, l.email)) = lower(l.email);
    if n >= v_cap then
      v_msg := 'This key is already on ' || v_cap::text || ' computer' || case when v_cap = 1 then '' else 's' end || '. Remove one in Settings > Devices.';
      return query select false, 'free', 'device_limit', l.email, l.current_period_end, n, v_cap, v_msg;
      return;
    end if;
    update public.devices d
      set removed_at = null,
          last_seen = now(),
          name = coalesce(nullif(btrim(p_name), ''), d.name),
          platform = coalesce(nullif(btrim(p_platform), ''), d.platform),
          app_version = coalesce(nullif(btrim(p_version), ''), d.app_version),
          seat_email = lower(l.email)
      where d.license_id = l.id and d.device_id = v_device and d.removed_at is not null;
    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      insert into public.devices (license_id, device_id, name, platform, app_version, seat_email)
      values (
        l.id,
        v_device,
        left(nullif(btrim(p_name), ''), 80),
        left(nullif(btrim(p_platform), ''), 40),
        left(nullif(btrim(p_version), ''), 40),
        lower(l.email)
      );
    end if;
  end if;

  select count(*) into n from public.devices d
    where d.license_id = l.id
      and d.removed_at is null
      and lower(coalesce(d.seat_email, l.email)) = lower(l.email);
  return query select true, l.tier, l.status, l.email, l.current_period_end, n, v_cap, 'ok';
end $$;

-- Redeem. A code with promo_codes.email set works only for that person.
create or replace function public.redeem_promo(p_code text, p_email text)
returns table (key text, tier text, message text)
language plpgsql security definer set search_path = public as $$
declare pc public.promo_codes%rowtype; k text; v_email text;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return query select null::text, null::text, 'Enter the email this code is for';
    return;
  end if;
  select * into pc from public.promo_codes where code = upper(btrim(p_code)) for update;
  if not found or pc.uses >= pc.max_uses or (pc.expires_at is not null and pc.expires_at < now()) then
    return query select null::text, null::text, 'Code is invalid, used up, or expired';
    return;
  end if;
  if nullif(btrim(pc.email), '') is not null and lower(btrim(pc.email)) <> v_email then
    return query select null::text, null::text, 'This code is for a different email';
    return;
  end if;
  k := public.gen_license_key();
  insert into public.licenses (key, email, tier, status, source, max_devices)
  values (k, v_email, pc.tier, 'active', 'promo', 2);
  update public.promo_codes set uses = uses + 1 where code = pc.code;
  return query select k, pc.tier, 'ok';
end $$;

-- Computers on the key this install holds. The key is the secret on the desktop app.
-- A signed-in hub user must also match the licence email.
create or replace function public.list_license_devices(p_key text, p_device_id text default null)
returns table (device_id text, name text, platform text, last_seen timestamptz, this_computer boolean)
language plpgsql security definer set search_path = public as $$
declare l public.licenses%rowtype; v_role text;
begin
  select * into l from public.licenses where key = upper(btrim(coalesce(p_key, '')));
  if not found then return; end if;
  v_role := coalesce(auth.role(), '');
  if v_role = 'authenticated' and lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(l.email) then
    return;
  end if;
  return query
    select d.device_id, d.name, d.platform, d.last_seen,
           (p_device_id is not null and d.device_id = left(btrim(p_device_id), 128))
    from public.devices d
    where d.license_id = l.id
      and d.removed_at is null
      and lower(coalesce(d.seat_email, l.email)) = lower(l.email)
    order by d.last_seen desc;
end $$;

create or replace function public.remove_license_device(p_key text, p_device_id text)
returns table (ok boolean, message text)
language plpgsql security definer set search_path = public as $$
declare l public.licenses%rowtype; v_device text; v_role text; n int;
begin
  v_device := left(nullif(btrim(coalesce(p_device_id, '')), ''), 128);
  if v_device is null then
    return query select false, 'Choose a computer to remove';
    return;
  end if;
  select * into l from public.licenses where key = upper(btrim(coalesce(p_key, '')));
  if not found then
    return query select false, 'Licence key not found';
    return;
  end if;
  v_role := coalesce(auth.role(), '');
  if v_role = 'authenticated' and lower(coalesce(auth.jwt() ->> 'email', '')) <> lower(l.email) then
    return query select false, 'This licence is for a different account';
    return;
  end if;
  update public.devices d
    set removed_at = now()
    where d.license_id = l.id
      and d.device_id = v_device
      and d.removed_at is null
      and lower(coalesce(d.seat_email, l.email)) = lower(l.email);
  get diagnostics n = row_count;
  if n = 0 then
    return query select false, 'That computer is not on this key';
    return;
  end if;
  return query select true, 'Removed';
end $$;

-- Owner script only. The anon key cannot mint a tester code.
create or replace function public.create_tester_code(p_email text, p_code text, p_tier text default 'pro')
returns text
language plpgsql security definer set search_path = public as $$
declare v_email text; v_code text; v_tier text; v_role text;
begin
  begin
    v_role := nullif(current_setting('request.jwt.claim.role', true), '');
  exception when others then
    v_role := null;
  end;
  if v_role is null then v_role := nullif(auth.role(), ''); end if;
  if v_role is distinct from 'service_role' then
    raise exception 'owner only';
  end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email required';
  end if;
  v_tier := lower(btrim(coalesce(p_tier, 'pro')));
  if v_tier not in ('pro', 'studio') then
    raise exception 'tier must be pro or studio';
  end if;
  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code !~ '^TEST-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$' then
    raise exception 'code required';
  end if;
  insert into public.promo_codes (code, tier, max_uses, uses, email)
  values (v_code, v_tier, 1, 0, v_email);
  return v_code;
end $$;

revoke all on function public.create_tester_code(text, text, text) from public, anon, authenticated;
grant execute on function public.create_tester_code(text, text, text) to service_role;

grant execute on function public.verify_license(text, text, text, text, text) to anon, authenticated;
grant execute on function public.redeem_promo(text, text) to anon, authenticated;
grant execute on function public.list_license_devices(text, text) to anon, authenticated;
grant execute on function public.remove_license_device(text, text) to anon, authenticated;
