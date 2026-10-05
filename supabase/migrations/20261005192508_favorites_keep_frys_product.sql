alter table public.favorites
  add column if not exists kroger_product_id text,
  add column if not exists brand text,
  add column if not exists size text;

comment on column public.favorites.kroger_product_id is 'Fry''s (Kroger) product ID the person picked. Only name, brand, size and ID are kept; pictures are fetched live.';

-- Carry the Fry''s product over for favorites that were saved from a Fry''s item.
update public.favorites f
   set kroger_product_id = s.kroger_product_id, brand = s.brand, size = s.size
  from (
    select distinct on (household_id, lower(name)) household_id, lower(name) as lname, kroger_product_id, brand, size
      from public.grocery_items
     where kroger_product_id is not null
     order by household_id, lower(name), created_at desc
  ) s
 where s.household_id = f.household_id
   and s.lname = lower(f.name)
   and f.kroger_product_id is null;

create or replace function public.add_favorites_to_list(favorite_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  hid uuid := public.current_household_id();
  lst public.grocery_lists;
  added int;
begin
  if hid is null then
    raise exception 'not in a household';
  end if;
  lst := public.ensure_active_list();

  with ins as (
    insert into public.grocery_items (household_id, list_id, name, quantity, notes, category, added_by, kroger_product_id, brand, size)
    select hid, lst.id, f.name, f.quantity, f.notes, f.category, auth.uid(), f.kroger_product_id, f.brand, f.size
      from public.favorites f
     where f.household_id = hid
       and (favorite_ids is null or f.id = any (favorite_ids))
       and not exists (
         select 1 from public.grocery_items gi
          where gi.list_id = lst.id and not gi.checked
            and (
              lower(trim(gi.name)) = lower(trim(f.name))
              or (f.kroger_product_id is not null and gi.kroger_product_id = f.kroger_product_id)
            ))
    returning 1
  )
  select count(*) into added from ins;
  return added;
end
$function$;
