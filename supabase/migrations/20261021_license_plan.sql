-- Licence plan for the owner metrics report (monthly, yearly, or lifetime).
-- Migration file only. Do not run this from the app or from a deploy. Apply it by hand in the
-- Supabase SQL editor after review. It has not been run on any database.
--
-- Prices are not stored here. The report reads the plan id and looks up the list price in
-- server/metrics-prices.js. A null plan is counted as that tier's monthly price.
-- studio remains the stored tier. The report treats studio as Extreme.
-- This file does not call Square and does not change a charge.

alter table public.licenses add column if not exists plan text;

alter table public.licenses drop constraint if exists licenses_plan_check;
alter table public.licenses add constraint licenses_plan_check
  check (plan is null or plan in (
    'pro-monthly',
    'pro-yearly',
    'extreme-monthly',
    'extreme-yearly',
    'lifetime-349',
    'lifetime-499'
  ));
