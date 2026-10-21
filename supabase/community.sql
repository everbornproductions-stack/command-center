-- Meldmind community chat, AI News, and the optional email list.
-- MIGRATION FILE ONLY. Review it, then run it yourself in the Supabase SQL editor. Safe to re-run.
-- The app does not run this file. It was not run against a live database.
-- People sign in with the email on their licence. Keys and private files are not stored here.
-- AI News drafts stay hidden. Only a published issue is readable. Email is opt-in and is never sent by the app.

create table if not exists public.community_profiles (
  email        text primary key,
  user_id      uuid references auth.users(id) on delete set null,
  display_name text not null,
  muted_until  timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.community_messages (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null check (channel in ('general', 'prompts', 'builders', 'help', 'show')),
  email        text not null,
  display_name text not null,
  body         text not null check (char_length(body) <= 2000),
  kind         text not null default 'text' check (kind in ('text', 'prompt', 'builder', 'mission', 'news')),
  share        jsonb,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists community_messages_channel_idx on public.community_messages (channel, created_at desc);

create table if not exists public.community_reports (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.community_messages(id) on delete cascade,
  email       text not null,
  reason      text not null check (char_length(reason) between 3 and 300),
  created_at  timestamptz not null default now(),
  unique (message_id, email)
);

create table if not exists public.community_prompt_votes (
  email      text not null,
  prompt_id  text not null,
  vote       smallint not null check (vote in (1, -1)),
  updated_at timestamptz not null default now(),
  primary key (email, prompt_id)
);

create table if not exists public.ai_news_issues (
  id           text primary key,
  week         text not null,
  status       text not null check (status in ('draft', 'published')),
  body         jsonb not null,
  published_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table if not exists public.ai_news_reactions (
  email      text not null,
  issue_id   text not null references public.ai_news_issues(id) on delete cascade,
  item_id    text not null,
  reaction   smallint not null check (reaction in (1, -1)),
  updated_at timestamptz not null default now(),
  primary key (email, issue_id, item_id)
);

create table if not exists public.newsletter_subscribers (
  email       text primary key,
  opted_in    boolean not null default false,
  unsub_token text not null,
  updated_at  timestamptz not null default now()
);

alter table public.community_profiles enable row level security;
alter table public.community_messages enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_prompt_votes enable row level security;
alter table public.ai_news_issues enable row level security;
alter table public.ai_news_reactions enable row level security;
alter table public.newsletter_subscribers enable row level security;

revoke all on table public.community_profiles from anon, authenticated;
revoke all on table public.community_messages from anon, authenticated;
revoke all on table public.community_reports from anon, authenticated;
revoke all on table public.community_prompt_votes from anon, authenticated;
revoke all on table public.ai_news_issues from anon, authenticated;
revoke all on table public.ai_news_reactions from anon, authenticated;
revoke all on table public.newsletter_subscribers from anon, authenticated;

-- Signed-in hub users can read public chat and published news. Writes go through the functions below,
-- which also serve the desktop app (licence key, no Supabase password).

drop policy if exists community_messages_read on public.community_messages;
create policy community_messages_read on public.community_messages
  for select to authenticated
  using (deleted_at is null);

drop policy if exists ai_news_read_published on public.ai_news_issues;
create policy ai_news_read_published on public.ai_news_issues
  for select to authenticated
  using (status = 'published');

create or replace function public.community_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.licenses
    where status = 'active'
      and tier = 'owner'
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.community_licence(p_key text)
returns public.licenses
language sql
stable
security definer
set search_path = public
as $$
  select * from public.licenses
  where key = upper(trim(coalesce(p_key, '')))
    and status = 'active'
  limit 1;
$$;

create or replace function public.community_post(
  p_key text,
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
  l public.licenses%rowtype;
  n int;
  mid uuid;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null then
    return jsonb_build_object('ok', false, 'message', 'Use the email on your licence.');
  end if;
  if p_channel not in ('general', 'prompts', 'builders', 'help', 'show') then
    return jsonb_build_object('ok', false, 'message', 'Pick a channel first.');
  end if;
  if p_body is null or char_length(trim(p_body)) < 1 or char_length(p_body) > 2000 then
    return jsonb_build_object('ok', false, 'message', 'Write a message first.');
  end if;
  if p_body ~ '(sk-|AIza|xai-|gsk_|BEGIN PRIVATE|id_rsa)' then
    return jsonb_build_object('ok', false, 'message', 'That message looks like a key or a private file. It was not sent.');
  end if;
  if exists (
    select 1 from public.community_profiles
    where lower(email) = lower(l.email) and muted_until is not null and muted_until > now()
  ) then
    return jsonb_build_object('ok', false, 'message', 'You are muted.');
  end if;
  select count(*) into n from public.community_messages
    where lower(email) = lower(l.email) and created_at > now() - interval '8 seconds' and deleted_at is null;
  if n >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Slow down a moment, then try again.');
  end if;
  insert into public.community_profiles (email, display_name)
    values (lower(l.email), left(coalesce(nullif(trim(p_name), ''), 'Member'), 24))
    on conflict (email) do update set display_name = excluded.display_name;
  insert into public.community_messages (channel, email, display_name, body, kind, share)
    values (p_channel, lower(l.email), left(coalesce(nullif(trim(p_name), ''), 'Member'), 24), trim(p_body), coalesce(p_kind, 'text'), p_share)
    returning id into mid;
  return jsonb_build_object('ok', true, 'id', mid);
end;
$$;

create or replace function public.community_list(p_channel text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'channel', m.channel,
    'displayName', m.display_name,
    'body', m.body,
    'kind', m.kind,
    'share', m.share,
    'createdAt', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  from (
    select * from public.community_messages
    where channel = p_channel and deleted_at is null
    order by created_at desc
    limit 100
  ) m;
$$;

create or replace function public.community_report(p_key text, p_message uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null then
    return jsonb_build_object('ok', false, 'message', 'Use the email on your licence.');
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    return jsonb_build_object('ok', false, 'message', 'Say why you are reporting it, in a short note.');
  end if;
  insert into public.community_reports (message_id, email, reason)
    values (p_message, lower(l.email), left(trim(p_reason), 300))
    on conflict (message_id, email) do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.community_delete(p_key text, p_message uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
  owner boolean;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null then
    return jsonb_build_object('ok', false, 'message', 'Use the email on your licence.');
  end if;
  owner := l.tier = 'owner';
  update public.community_messages
    set deleted_at = now(), body = '', share = null
    where id = p_message
      and deleted_at is null
      and (owner or lower(email) = lower(l.email));
  if not found then
    return jsonb_build_object('ok', false, 'message', 'Only the owner can remove someone else''s message.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.community_mute(p_key text, p_email text, p_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null or l.tier <> 'owner' then
    return jsonb_build_object('ok', false, 'message', 'Only the owner can mute someone.');
  end if;
  insert into public.community_profiles (email, display_name, muted_until)
    values (lower(trim(p_email)), 'Member', now() + make_interval(mins => greatest(1, least(p_minutes, 43200))))
    on conflict (email) do update
      set muted_until = now() + make_interval(mins => greatest(1, least(p_minutes, 43200)));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.ai_news_latest()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('ok', true, 'issue', body)
  from public.ai_news_issues
  where status = 'published'
  order by published_at desc nulls last
  limit 1;
$$;

create or replace function public.save_ai_news_draft(p_key text, p_issue jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
  iid text;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null or l.tier <> 'owner' then
    return jsonb_build_object('ok', false, 'message', 'Only the owner can build a draft.');
  end if;
  iid := coalesce(p_issue->>'id', p_issue->>'week');
  if iid is null or iid = '' then
    return jsonb_build_object('ok', false, 'message', 'The draft is missing.');
  end if;
  insert into public.ai_news_issues (id, week, status, body)
    values (iid, coalesce(p_issue->>'week', iid), 'draft', p_issue || jsonb_build_object('status', 'draft'))
    on conflict (id) do update
      set status = 'draft', body = excluded.body, updated_at = now()
      where public.ai_news_issues.status <> 'published';
  return jsonb_build_object('ok', true, 'id', iid);
end;
$$;

create or replace function public.publish_ai_news(p_key text, p_issue jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
  iid text;
  issue jsonb;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null or l.tier <> 'owner' then
    return jsonb_build_object('ok', false, 'message', 'Only the owner can publish AI News.');
  end if;
  iid := coalesce(p_issue->>'id', p_issue->>'week');
  if iid is null or iid = '' then
    return jsonb_build_object('ok', false, 'message', 'The draft is missing.');
  end if;
  issue := p_issue || jsonb_build_object('status', 'published', 'publishedAt', to_jsonb(now()));
  insert into public.ai_news_issues (id, week, status, body, published_at)
    values (iid, coalesce(p_issue->>'week', iid), 'published', issue, now())
    on conflict (id) do update
      set status = 'published', body = excluded.body, published_at = now(), updated_at = now();
  return jsonb_build_object('ok', true, 'id', iid);
end;
$$;

create or replace function public.ai_news_react(p_key text, p_issue text, p_item text, p_reaction text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
  vote smallint;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null then
    return jsonb_build_object('ok', false, 'message', 'Use the email on your licence.');
  end if;
  if p_reaction is null or p_reaction = '' or p_reaction = 'clear' then
    delete from public.ai_news_reactions
      where issue_id = p_issue and item_id = p_item and lower(email) = lower(l.email);
  else
    vote := case when p_reaction = 'up' then 1 when p_reaction = 'down' then -1 else null end;
    if vote is null then
      return jsonb_build_object('ok', false, 'message', 'Choose a reaction.');
    end if;
    insert into public.ai_news_reactions (email, issue_id, item_id, reaction)
      values (lower(l.email), p_issue, p_item, vote)
      on conflict (email, issue_id, item_id) do update set reaction = excluded.reaction, updated_at = now();
  end if;
  return (
    select jsonb_build_object(
      'ok', true,
      'up', count(*) filter (where reaction = 1),
      'down', count(*) filter (where reaction = -1)
    )
    from public.ai_news_reactions
    where issue_id = p_issue and item_id = p_item
  );
end;
$$;

create or replace function public.newsletter_set(p_key text, p_email text, p_opted_in boolean, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.licenses%rowtype;
begin
  select * into l from public.community_licence(p_key);
  if l.id is null or lower(l.email) <> lower(trim(coalesce(p_email, ''))) then
    return jsonb_build_object('ok', false, 'message', 'Use the email on your licence.');
  end if;
  if p_token is null or char_length(p_token) < 8 then
    return jsonb_build_object('ok', false, 'message', 'Missing unsubscribe token.');
  end if;
  insert into public.newsletter_subscribers (email, opted_in, unsub_token)
    values (lower(l.email), coalesce(p_opted_in, false), p_token)
    on conflict (email) do update
      set opted_in = excluded.opted_in, unsub_token = excluded.unsub_token, updated_at = now();
  return jsonb_build_object('ok', true, 'optedIn', coalesce(p_opted_in, false));
end;
$$;

create or replace function public.newsletter_unsubscribe(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.newsletter_subscribers
    set opted_in = false, updated_at = now()
    where unsub_token = coalesce(p_token, '');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.community_is_owner() from public;
revoke all on function public.community_licence(text) from public;
revoke all on function public.community_post(text, text, text, text, text, jsonb) from public;
revoke all on function public.community_list(text) from public;
revoke all on function public.community_report(text, uuid, text) from public;
revoke all on function public.community_delete(text, uuid) from public;
revoke all on function public.community_mute(text, text, int) from public;
revoke all on function public.ai_news_latest() from public;
revoke all on function public.save_ai_news_draft(text, jsonb) from public;
revoke all on function public.publish_ai_news(text, jsonb) from public;
revoke all on function public.ai_news_react(text, text, text, text) from public;
revoke all on function public.newsletter_set(text, text, boolean, text) from public;
revoke all on function public.newsletter_unsubscribe(text) from public;

grant execute on function public.community_is_owner() to authenticated;
grant execute on function public.community_list(text) to anon, authenticated;
grant execute on function public.ai_news_latest() to anon, authenticated;
grant execute on function public.community_post(text, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.community_report(text, uuid, text) to anon, authenticated;
grant execute on function public.community_delete(text, uuid) to anon, authenticated;
grant execute on function public.community_mute(text, text, int) to anon, authenticated;
grant execute on function public.save_ai_news_draft(text, jsonb) to anon, authenticated;
grant execute on function public.publish_ai_news(text, jsonb) to anon, authenticated;
grant execute on function public.ai_news_react(text, text, text, text) to anon, authenticated;
grant execute on function public.newsletter_set(text, text, boolean, text) to anon, authenticated;
grant execute on function public.newsletter_unsubscribe(text) to anon, authenticated;
