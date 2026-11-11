-- Unlock by email now needs proof (0.4.19).
-- MIGRATION FILE ONLY. Chris reviews it and applies it once, AFTER 20261025_stripe.sql. Safe to re-run.
--
-- Problem: activate_license_by_email was callable by anon with any email, so anyone could ask whether
-- an address has a paid plan (and which one).
-- Fix: the function reads the email from the caller's signed Supabase session (auth.uid()), and only
-- when that account's email is confirmed in auth.users. The p_email argument is kept so older apps
-- still call it, but it is never trusted: if it is given and differs from the session email the answer
-- is the same "no licence" reply. Every miss (no session, unconfirmed email, no licence) returns the
-- same message, so the reply cannot be used to find out whether an address is a customer.
-- anon can no longer run it. The app gets a session by exchanging its Google or Microsoft id_token
-- (server/licence-session.js). Before this works, in the Supabase dashboard (Authentication,
-- Providers) turn on Google and Azure/Microsoft and add the app's OAuth client ids under
-- "Authorized Client IDs" (Google) / the client id (Azure).

create or replace function public.activate_license_by_email(p_email text, p_device_id text default null, p_name text default null, p_platform text default null, p_version text default null)
returns table (ok boolean, tier text, status text, email text, period_end timestamptz, devices int, max_devices int, message text, plan text)
language plpgsql security definer set search_path = public as $$
declare l public.licenses%rowtype; v_email text; v_given text;
begin
  v_email := null;
  if auth.uid() is not null then
    select lower(btrim(u.email)) into v_email
    from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null;
  end if;
  v_given := lower(btrim(coalesce(p_email, '')));
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_email) > 254
     or (v_given <> '' and v_given <> v_email) then
    return query select false, 'free', 'unknown', null::text, null::timestamptz, 0, 0, 'No active licence on this email yet', null::text;
    return;
  end if;
  l := public.find_active_license_by_email(v_email);
  if l.id is null then
    return query select false, 'free', 'unknown', null::text, null::timestamptz, 0, 0, 'No active licence on this email yet', null::text;
    return;
  end if;
  return query select true, l.tier, l.status, l.email, l.current_period_end, 0, coalesce(l.max_devices, 2), 'ok', l.plan;
end $$;
revoke all on function public.activate_license_by_email(text, text, text, text, text) from public, anon;
grant execute on function public.activate_license_by_email(text, text, text, text, text) to authenticated;
