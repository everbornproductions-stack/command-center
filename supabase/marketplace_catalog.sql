-- Marketplace catalog source (0.4.21). NOT RUN. Chris runs this once in the Supabase SQL editor
-- for the project the app already uses (see docs/RELEASING.md, Owner checklist).
-- The app reads free, listed rows with the publishable key. Paid rows are never read by the app.
-- It extends the sketch in supabase/marketplace.sql; run that table definition first if the
-- table does not exist yet.

alter table public.market_listings add column if not exists example text;
alter table public.market_listings add column if not exists sig text;   -- Ed25519 signature, base64 (optional until the catalog key is set)

alter table public.market_listings enable row level security;

drop policy if exists "catalog free listed rows are public" on public.market_listings;
create policy "catalog free listed rows are public"
  on public.market_listings for select
  to anon, authenticated
  using (status = 'listed' and price_type = 'free');

-- Only Everborn publishes (service key or the SQL editor). The app never writes here.
revoke insert, update, delete on public.market_listings from anon, authenticated;
grant select on public.market_listings to anon, authenticated;

-- Example row (body is a pipeline: name, steps, inputs). Replace and run when you publish.
-- insert into public.market_listings (id, kind, title, category, promise, example, body, price_type, status)
-- values ('week-of-posts', 'pipeline', 'Week of posts', 'Social Posts',
--   'Four post ideas with captions, from your brand notes.', 'Monday: the door opens.',
--   '{"name":"Week of posts","steps":[{"title":"Angles","capability":"creative","instructions":"Give three angles for {brand}."}],"inputs":[{"key":"brand","label":"Brand"}]}',
--   'free', 'listed');
