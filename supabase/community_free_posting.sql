-- Meldmind 0.4.20: let free signed-in people post in the shared Community room.
-- MIGRATION FILE ONLY. Review it, then run it yourself in the Supabase SQL editor after supabase/community.sql. Safe to re-run.
-- The app does not run this file. It was not run against a live database.
--
-- How it works: a free install has no licence key, so it sends a random device token (kept only in its own data folder).
-- The room stores the token's SHA-256 hash, never the token, and never an email. A free poster has a public username
-- like everyone else, unique across licensed profiles and other free posters.
-- Brakes: 3 posts per 10 seconds and 30 per hour per device, 300 free posts per hour room-wide, and a muted_until per device.
-- Turn it off any time with:  drop function if exists public.community_post_free(text, text, text, text, text, jsonb);
-- (the app then tells free people, before they type, that posting needs a License key for now.)

create table if not exists public.community_free_devices (
  device_hash text primary key,
  username    text not null,
  muted_until timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists community_free_devices_username_idx on public.community_free_devices (lower(username));
alter table public.community_free_devices enable row level security;
revoke all on table public.community_free_devices from anon, authenticated;

create or replace function public.community_post_free(
  p_device text,
  p_channel text,
  p_name text,
  p_body text,
  p_kind text default 'text',
  p_share jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  h text;
  dev public.community_free_devices%rowtype;
  clean text;
  n int;
  mid uuid;
begin
  if p_device is null or char_length(p_device) < 24 or char_length(p_device) > 128 then
    return jsonb_build_object('ok', false, 'message', 'This install could not be recognised. Restart the app and try again.');
  end if;
  if p_channel not in ('general', 'prompts', 'builders', 'help', 'show') then
    return jsonb_build_object('ok', false, 'message', 'Pick a channel first.');
  end if;
  if p_kind is not null and p_kind not in ('text', 'prompt', 'builder', 'mission', 'news') then
    return jsonb_build_object('ok', false, 'message', 'That kind of message is not allowed.');
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 then
    return jsonb_build_object('ok', false, 'message', 'Write a message first.');
  end if;
  if p_body ~ '(sk-|AIza|xai-|gsk_|BEGIN PRIVATE|id_rsa)' then
    return jsonb_build_object('ok', false, 'message', 'That message looks like a key or a private file. It was not sent.');
  end if;
  clean := btrim(coalesce(p_name, ''));
  if clean !~ '^[A-Za-z0-9_]{3,20}$' then
    return jsonb_build_object('ok', false, 'message', 'Pick a username first.');
  end if;
  h := encode(sha256(convert_to(p_device, 'UTF8')), 'hex');
  select * into dev from public.community_free_devices where device_hash = h;
  if dev.device_hash is null then
    if exists (select 1 from public.community_profiles where lower(username) = lower(clean))
       or exists (select 1 from public.community_free_devices where lower(username) = lower(clean)) then
      return jsonb_build_object('ok', false, 'message', 'That username is taken. Pick another in Settings.');
    end if;
    insert into public.community_free_devices (device_hash, username) values (h, clean);
    dev.username := clean;
  elsif lower(dev.username) <> lower(clean) then
    -- a free poster can change name, but not to someone else's
    if exists (select 1 from public.community_profiles where lower(username) = lower(clean))
       or exists (select 1 from public.community_free_devices where lower(username) = lower(clean) and device_hash <> h) then
      return jsonb_build_object('ok', false, 'message', 'That username is taken. Pick another in Settings.');
    end if;
    update public.community_free_devices set username = clean where device_hash = h;
    dev.username := clean;
  end if;
  if dev.muted_until is not null and dev.muted_until > now() then
    return jsonb_build_object('ok', false, 'message', 'You are muted.');
  end if;
  select count(*) into n from public.community_messages
    where email = 'free:' || left(h, 16) and created_at > now() - interval '10 seconds' and deleted_at is null;
  if n >= 3 then
    return jsonb_build_object('ok', false, 'message', 'Slow down a moment, then try again.');
  end if;
  select count(*) into n from public.community_messages
    where email = 'free:' || left(h, 16) and created_at > now() - interval '1 hour' and deleted_at is null;
  if n >= 30 then
    return jsonb_build_object('ok', false, 'message', 'You have sent enough for this hour. Try again later.');
  end if;
  select count(*) into n from public.community_messages
    where email like 'free:%' and created_at > now() - interval '1 hour' and deleted_at is null;
  if n >= 300 then
    return jsonb_build_object('ok', false, 'message', 'The room is very busy with new members right now. Try again in a little while.');
  end if;
  insert into public.community_messages (channel, email, display_name, body, kind, share)
    values (p_channel, 'free:' || left(h, 16), dev.username, trim(p_body), coalesce(p_kind, 'text'), p_share)
    returning id into mid;
  return jsonb_build_object('ok', true, 'id', mid);
end;
$$;

grant execute on function public.community_post_free(text, text, text, text, text, jsonb) to anon, authenticated;
