-- Marketplace tables (Phase 10). SKETCH ONLY. DO NOT RUN.
-- The app does not read this file. Phase 10 stores the catalog on the computer
-- (marketplace.*.json via the usual documents). A hosted catalog is not connected,
-- and nothing here charges money or pays a seller.

-- market_listings: one row per seller listing (pipeline, agent, or prompt JSON).
-- price_type is free, once, or bundle. price_usd is a placeholder until pricing is decided.
-- status is draft, pending, listed, rejected, or pulled.
create table if not exists public.market_listings (
  id            text primary key,
  seller_id     uuid,
  kind          text not null,
  title         text not null,
  category      text,
  promise       text,
  body          jsonb not null,
  price_type    text not null default 'free',
  price_usd     numeric,
  price_placeholder boolean not null default true,
  version       int not null default 1,
  status        text not null default 'draft',
  everborn_pct  int not null default 20,
  seller_pct    int not null default 80,
  created_at    timestamptz not null default now()
);

-- market_installs: which version a person copied onto their account.
create table if not exists public.market_installs (
  user_id     uuid,
  listing_id  text,
  version     int not null,
  installed_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- market_reviews: a star rating from someone who installed the listing.
create table if not exists public.market_reviews (
  id          text primary key,
  listing_id  text not null,
  user_id     uuid,
  stars       int not null,
  note        text,
  created_at  timestamptz not null default now()
);

-- market_reports: a complaint. The listing stays out of the catalog until review.
create table if not exists public.market_reports (
  id          text primary key,
  listing_id  text not null,
  reason      text not null,
  open        boolean not null default true,
  created_at  timestamptz not null default now()
);
