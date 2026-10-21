-- Extreme tier on licences. Chris runs this in the Supabase SQL editor. The app does not run it.
-- It does not call Square and it does not change a price.
alter table public.licenses drop constraint if exists licenses_tier_check;
alter table public.licenses add constraint licenses_tier_check check (tier in ('free','pro','extreme','studio','owner'));
