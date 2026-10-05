-- Applied from the Supabase dashboard alongside the kroger-search Edge Function;
-- kept here so a fresh database matches production.
alter table public.grocery_items
  add column if not exists kroger_product_id text,
  add column if not exists brand text,
  add column if not exists size text;

comment on column public.grocery_items.kroger_product_id is 'Kroger/Fry''s product ID chosen from live search; used to re-fetch picture/details live. No catalog data is stored.';
