-- Optional encrypted chat sync (Phase 23). Migration file only: it has NOT been run on any live project.
-- Chris (or the person who owns the Supabase project) runs it in the SQL editor when sync is wanted.
--
-- What the server holds: per space a salt, the key-derivation settings, one sealed check value and the
-- SHA-256 of the space token; per chat an opaque item id (an HMAC of the chat id), a sealed blob and a
-- sequence number. No titles, no text, no chat ids, no passphrase, no key. See server/history-sync.js and
-- web/sync-crypto.js for the client side.
--
-- Row-level security is on for both tables with NO policies, so the publishable key cannot read or write
-- them directly. The only way in is the four security-definer functions below, and every one that reads or
-- writes chat blobs checks the token.
create extension if not exists pgcrypto;

create table if not exists public.cc_sync_spaces (
  space       text primary key check (space ~ '^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$'),
  token_hash  text not null,
  salt        text not null,
  kdf         jsonb not null,
  check_blob  text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.cc_sync_items (
  space       text not null references public.cc_sync_spaces(space) on delete cascade,
  item        text not null check (item ~ '^[0-9a-f]{40}$'),
  blob        text not null check (length(blob) <= 1500000),
  seq         bigserial,
  updated_at  timestamptz not null default now(),
  primary key (space, item)
);
create index if not exists cc_sync_items_seq on public.cc_sync_items (space, seq);

alter table public.cc_sync_spaces enable row level security;
alter table public.cc_sync_items  enable row level security;
revoke all on public.cc_sync_spaces, public.cc_sync_items from anon, authenticated;

create or replace function public.cc_sync_token_ok(p_space text, p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_sync_spaces s where s.space = p_space and s.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex'));
$$;
revoke all on function public.cc_sync_token_ok(text, text) from public, anon, authenticated;

create or replace function public.cc_sync_create(p_space text, p_token text, p_salt text, p_kdf jsonb, p_check text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(p_token, '')) < 40 then raise exception 'bad sync token'; end if;
  if exists (select 1 from cc_sync_spaces where space = p_space) then raise exception 'space exists'; end if;
  insert into cc_sync_spaces (space, token_hash, salt, kdf, check_blob) values (p_space, encode(digest(p_token, 'sha256'), 'hex'), p_salt, p_kdf, p_check);
  return jsonb_build_object('ok', true);
end $$;

-- the salt, kdf and check value are needed BEFORE a second device has the key; the code itself is the secret here
create or replace function public.cc_sync_meta(p_space text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('salt', salt, 'kdf', kdf, 'check', check_blob) from cc_sync_spaces where space = p_space;
$$;

create or replace function public.cc_sync_push(p_space text, p_token text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int := 0; it jsonb;
begin
  if not cc_sync_token_ok(p_space, p_token) then raise exception 'bad sync token'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too many items'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    insert into cc_sync_items (space, item, blob, updated_at)
      values (p_space, it->>'item', it->>'blob', coalesce((it->>'updated_at')::timestamptz, now()))
      on conflict (space, item) do update set blob = excluded.blob, updated_at = excluded.updated_at, seq = nextval(pg_get_serial_sequence('public.cc_sync_items', 'seq'));
    n := n + 1;
  end loop;
  return jsonb_build_object('stored', n);
end $$;

create or replace function public.cc_sync_pull(p_space text, p_token text, p_since bigint, p_limit int) returns setof jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not cc_sync_token_ok(p_space, p_token) then raise exception 'bad sync token'; end if;
  return query select jsonb_build_object('item', item, 'blob', blob, 'seq', seq, 'updated_at', updated_at)
    from cc_sync_items where space = p_space and seq > coalesce(p_since, 0) order by seq limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;

create or replace function public.cc_sync_delete_space(p_space text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not cc_sync_token_ok(p_space, p_token) then raise exception 'bad sync token'; end if;
  delete from cc_sync_spaces where space = p_space;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.cc_sync_create(text, text, text, jsonb, text), public.cc_sync_meta(text), public.cc_sync_push(text, text, jsonb), public.cc_sync_pull(text, text, bigint, int), public.cc_sync_delete_space(text, text) to anon, authenticated;
