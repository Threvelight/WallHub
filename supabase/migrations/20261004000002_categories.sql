-- Grocery categories: seven standard ones per household plus owner-added custom ones.
-- Items carry category_id; the list groups by category name.

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  is_custom    boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
create unique index categories_household_name_idx
  on public.categories (household_id, lower(trim(name)));

alter table public.grocery_items
  add column category_id uuid references public.categories (id) on delete set null;
create index grocery_items_category_idx on public.grocery_items (category_id);

-- ---------------------------------------------------------------------------
-- Defaults
-- ---------------------------------------------------------------------------

create or replace function public.seed_default_categories(hid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.categories (household_id, name, is_custom, sort_order)
  select hid, d.name, false, d.ord
    from unnest(array['Dairy', 'Frozen', 'Household', 'Meat', 'Other', 'Pantry', 'Produce'])
         with ordinality as d(name, ord)
  on conflict do nothing
$$;

create or replace function public.households_seed_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end
$$;
create trigger households_seed_categories after insert on public.households
  for each row execute function public.households_seed_categories();

select public.seed_default_categories(id) from public.households;

-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------

-- Items may only use their own household's categories.
create or replace function public.grocery_items_check_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.grocery_lists l
    where l.id = new.list_id and l.household_id = new.household_id
  ) then
    raise exception 'list does not belong to household';
  end if;
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and c.household_id = new.household_id
  ) then
    raise exception 'category does not belong to household';
  end if;
  return new;
end
$$;

-- Items added without a category (favorites, recipes, load last week) reuse the
-- category that item had last time, falling back to Other.
create or replace function public.grocery_items_default_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is null then
    select gi.category_id into new.category_id
      from public.grocery_items gi
     where gi.household_id = new.household_id
       and gi.category_id is not null
       and lower(trim(gi.name)) = lower(trim(new.name))
     order by gi.created_at desc
     limit 1;
  end if;
  if new.category_id is null then
    select c.id into new.category_id
      from public.categories c
     where c.household_id = new.household_id and c.name = 'Other' and not c.is_custom;
  end if;
  return new;
end
$$;
-- Named so it fires before grocery_items_household (triggers run in name order),
-- letting that trigger validate the chosen category.
create trigger grocery_items_a_default_category before insert on public.grocery_items
  for each row execute function public.grocery_items_default_category();

-- A custom category can't be deleted while an item on the current list uses it.
create or replace function public.categories_check_in_use()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Household being deleted: let the cascade through.
  if not exists (select 1 from public.households where id = old.household_id) then
    return old;
  end if;
  if exists (
    select 1 from public.grocery_items gi
      join public.grocery_lists gl on gl.id = gi.list_id
     where gi.category_id = old.id and gl.status = 'active'
  ) then
    raise exception 'category % is in use on the current list', old.name;
  end if;
  return old;
end
$$;
create trigger categories_in_use before delete on public.categories
  for each row execute function public.categories_check_in_use();

-- Existing items go under Other.
update public.grocery_items gi
   set category_id = c.id
  from public.categories c
 where gi.category_id is null
   and c.household_id = gi.household_id and c.name = 'Other' and not c.is_custom;

-- ---------------------------------------------------------------------------
-- Row Level Security: everyone reads; only the owner adds or deletes custom ones.
-- No updates (rename = delete and re-add).
-- ---------------------------------------------------------------------------

alter table public.categories enable row level security;

create policy categories_select on public.categories
  for select to authenticated using (household_id = public.current_household_id());
create policy categories_insert on public.categories
  for insert to authenticated
  with check (household_id = public.current_household_id()
              and public.is_household_owner() and is_custom);
create policy categories_delete on public.categories
  for delete to authenticated
  using (household_id = public.current_household_id()
         and public.is_household_owner() and is_custom);

revoke update on public.categories from authenticated, anon;

revoke execute on function public.seed_default_categories(uuid)         from public, anon, authenticated;
revoke execute on function public.households_seed_categories()          from public, anon, authenticated;
revoke execute on function public.grocery_items_default_category()      from public, anon, authenticated;
revoke execute on function public.categories_check_in_use()             from public, anon, authenticated;
revoke execute on function public.grocery_items_check_household()       from public, anon, authenticated;

alter table public.categories replica identity full;
alter publication supabase_realtime add table public.categories;
