-- Migration 2026-10-18: licence status 'pending' + CSPRNG licence keys.
-- Apply once in the Supabase SQL editor (project everborn-command) AFTER schema.sql. Not applied by the fix run.
--
-- 1. A Square subscription in PENDING (created, not yet paid) is stored as 'pending'. verify_license()
--    already treats every status other than 'active' as not OK, so nothing else has to change.
alter table public.licenses drop constraint if exists licenses_status_check;
alter table public.licenses add constraint licenses_status_check
  check (status in ('active', 'past_due', 'cancelled', 'revoked', 'pending'));

-- 2. Licence keys from gen_random_bytes (pgcrypto, enabled in schema.sql) instead of random().
--    Same shape as before: EVB-XXXX-XXXX-XXXX over a 32-letter alphabet (no 0/O/1/I); `& 31` on a
--    random byte picks one of exactly 32 letters, so there is no modulo bias.
create or replace function public.gen_license_key() returns text language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; res text := 'EVB'; b bytea; i int;
begin
  b := gen_random_bytes(12);
  for i in 0..11 loop
    if i % 4 = 0 then res := res || '-'; end if;
    res := res || substr(alphabet, 1 + (get_byte(b, i) & 31), 1);
  end loop;
  return res;
end $$;
