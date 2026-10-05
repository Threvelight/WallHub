-- Applied from the Supabase dashboard; kept here so a fresh database matches
-- production. Only the household owner can finalize the list.
create or replace function public.finish_list()
 returns grocery_lists
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  hid uuid := public.current_household_id();
  old_list public.grocery_lists;
  new_list public.grocery_lists;
  snapshot jsonb;
begin
  if hid is null then
    raise exception 'not in a household';
  end if;

  if not public.is_household_owner() then
    raise exception 'Only the household owner can finalize the list';
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
$function$;
