-- Past lists keep the exact Fry's product: snapshots carry brand, size and
-- kroger_product_id, and loading a past list restores them.

-- ---------------------------------------------------------------------------
-- Snapshot
-- ---------------------------------------------------------------------------

create or replace function public.finish_list()
returns public.grocery_lists
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.current_household_id();
  old_list public.grocery_lists;
  new_list public.grocery_lists;
  snapshot jsonb;
begin
  if hid is null then
    raise exception 'not in a household';
  end if;

  select * into old_list from public.grocery_lists
   where household_id = hid and status = 'active'
   for update;
  if not found then
    return public.ensure_active_list();
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', gi.name, 'quantity', gi.quantity, 'notes', gi.notes,
           'category', coalesce(c.name, gi.category), 'checked', gi.checked,
           'kroger_product_id', gi.kroger_product_id, 'brand', gi.brand, 'size', gi.size) order by gi.created_at), '[]'::jsonb)
    into snapshot
    from public.grocery_items gi
    left join public.categories c on c.id = gi.category_id
   where gi.list_id = old_list.id;

  if jsonb_array_length(snapshot) > 0 then
    insert into public.list_history (household_id, list_id, name, items, item_count, created_by)
    values (hid, old_list.id,
            'Week of ' || to_char(old_list.created_at at time zone 'UTC', 'Mon DD, YYYY'),
            snapshot, jsonb_array_length(snapshot), auth.uid());
  end if;

  update public.grocery_lists set status = 'completed', completed_at = now()
   where id = old_list.id;

  insert into public.grocery_lists (household_id, created_by)
  values (hid, auth.uid())
  returning * into new_list;

  update public.grocery_items set list_id = new_list.id
   where list_id = old_list.id and not checked;

  return new_list;
end
$$;

-- ---------------------------------------------------------------------------
-- Restore
-- ---------------------------------------------------------------------------

-- Typed items are matched by name, as before. Fry's items are matched by product
-- ID, so the 28 oz and 40 oz jars of the same peanut butter are two items, and a
-- product already on the list isn't added twice.
create or replace function public.load_history(history_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.current_household_id();
  lst public.grocery_lists;
  snap jsonb;
  added int;
begin
  if hid is null then
    raise exception 'not in a household';
  end if;
  lst := public.ensure_active_list();

  select items into snap from public.list_history
   where household_id = hid and (history_id is null or id = history_id)
   order by created_at desc
   limit 1;
  if snap is null then
    return 0;
  end if;

  with src as (
    select distinct on (coalesce('product:' || p.pid, 'name:' || lower(p.name)))
           p.name, p.quantity, p.notes, p.category, p.pid, p.brand, p.size
      from (
        select trim(e->>'name') as name, e->>'quantity' as quantity,
               e->>'notes' as notes, e->>'category' as category,
               nullif(trim(e->>'kroger_product_id'), '') as pid,
               nullif(trim(e->>'brand'), '') as brand,
               nullif(trim(e->>'size'), '') as size
          from jsonb_array_elements(snap) e
         where coalesce(trim(e->>'name'), '') <> ''
      ) p
  ), ins as (
    insert into public.grocery_items
      (household_id, list_id, name, quantity, notes, category, added_by, kroger_product_id, brand, size)
    select hid, lst.id, s.name, s.quantity, s.notes, s.category, auth.uid(), s.pid, s.brand, s.size
      from src s
     where not exists (
       select 1 from public.grocery_items gi
        where gi.list_id = lst.id
          and case when s.pid is null then lower(trim(gi.name)) = lower(s.name)
                   else gi.kroger_product_id = s.pid end)
    returning 1
  )
  select count(*) into added from ins;
  return added;
end
$$;
