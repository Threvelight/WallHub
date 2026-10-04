-- WallHub Phase 1 schema: households, members, grocery lists, recipes, favorites, history.
-- Every household-owned row carries household_id so Row Level Security can scope it,
-- and so Phase 2 tables (calendar, chores, budget) can follow the same pattern.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Household members. id is the Supabase auth user id.
create table public.users (
  id           uuid primary key references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now()
);
create index users_household_idx on public.users (household_id);

-- One shopping session. Exactly one 'active' list per household at a time.
create table public.grocery_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null default 'Groceries',
  status       text not null default 'active' check (status in ('active', 'completed')),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);
create unique index grocery_lists_one_active_idx
  on public.grocery_lists (household_id) where status = 'active';

create table public.recipes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  description  text,
  servings     int check (servings is null or servings > 0),
  instructions text,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index recipes_household_idx on public.recipes (household_id);

create table public.grocery_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id      uuid not null references public.grocery_lists (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  quantity     text,
  notes        text,
  category     text,
  checked      boolean not null default false,
  checked_at   timestamptz,
  checked_by   uuid references public.users (id) on delete set null,
  recipe_id    uuid references public.recipes (id) on delete set null,
  added_by     uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index grocery_items_list_idx on public.grocery_items (list_id);
create index grocery_items_household_idx on public.grocery_items (household_id);

-- Ingredients tie to grocery items by normalized name: adding a recipe to the list
-- creates (or merges into) a grocery_item with the same name.
create table public.recipe_ingredients (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipe_id    uuid not null references public.recipes (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  quantity     text,
  notes        text,
  position     int not null default 0
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id);

create table public.favorites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  quantity     text,
  notes        text,
  category     text,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index favorites_household_name_idx
  on public.favorites (household_id, lower(trim(name)));

-- Snapshot of a list when the household finishes a shopping trip.
-- items: [{name, quantity, notes, category, checked}]
create table public.list_history (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id      uuid references public.grocery_lists (id) on delete set null,
  name         text not null,
  items        jsonb not null default '[]'::jsonb,
  item_count   int not null default 0,
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index list_history_household_idx on public.list_history (household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's household. SECURITY DEFINER so policies on public.users don't recurse.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id from public.users where id = auth.uid()
$$;

create or replace function public.is_household_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'owner')
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger recipes_touch before update on public.recipes
  for each row execute function public.touch_updated_at();

-- Keep household_id consistent with the parent row so a client can't
-- attach an item to another household's list or recipe.
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
  return new;
end
$$;
create trigger grocery_items_household before insert or update on public.grocery_items
  for each row execute function public.grocery_items_check_household();

create or replace function public.recipe_ingredients_check_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.recipes r
    where r.id = new.recipe_id and r.household_id = new.household_id
  ) then
    raise exception 'recipe does not belong to household';
  end if;
  return new;
end
$$;
create trigger recipe_ingredients_household before insert or update on public.recipe_ingredients
  for each row execute function public.recipe_ingredients_check_household();

-- ---------------------------------------------------------------------------
-- RPCs (onboarding and list lifecycle)
-- ---------------------------------------------------------------------------

-- First member: creates the household, their profile, and the first active list.
create or replace function public.create_household(household_name text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from public.users where id = auth.uid()) then
    raise exception 'already in a household';
  end if;

  insert into public.households (name, created_by)
  values (trim(household_name), auth.uid())
  returning id into hid;

  insert into public.users (id, household_id, display_name, role)
  values (auth.uid(), hid, trim(member_name), 'owner');

  insert into public.grocery_lists (household_id, created_by)
  values (hid, auth.uid());

  return hid;
end
$$;

-- Wife / stepson: join with the invite code shown in Settings.
create or replace function public.join_household(code text, member_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from public.users where id = auth.uid()) then
    raise exception 'already in a household';
  end if;

  select id into hid from public.households where invite_code = upper(trim(code));
  if hid is null then
    raise exception 'invalid invite code';
  end if;

  insert into public.users (id, household_id, display_name)
  values (auth.uid(), hid, trim(member_name));

  return hid;
end
$$;

-- Owner can rotate the invite code once everyone has joined.
create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  update public.households h
     set invite_code = upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8))
   where h.id = public.current_household_id()
     and public.is_household_owner()
  returning invite_code into new_code;
  if new_code is null then
    raise exception 'only the household owner can do that';
  end if;
  return new_code;
end
$$;

-- Returns the active list, creating one if needed.
create or replace function public.ensure_active_list()
returns public.grocery_lists
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.current_household_id();
  lst public.grocery_lists;
begin
  if hid is null then
    raise exception 'not in a household';
  end if;
  select * into lst from public.grocery_lists where household_id = hid and status = 'active';
  if not found then
    insert into public.grocery_lists (household_id, created_by)
    values (hid, auth.uid())
    on conflict do nothing;
    select * into lst from public.grocery_lists where household_id = hid and status = 'active';
  end if;
  return lst;
end
$$;

-- "Done shopping": snapshot the active list into list_history, close it, and start a
-- new active list. Unchecked items (not bought) carry over to the new list.
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
           'name', name, 'quantity', quantity, 'notes', notes,
           'category', category, 'checked', checked) order by created_at), '[]'::jsonb)
    into snapshot
    from public.grocery_items where list_id = old_list.id;

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

-- "Load last week": copy a snapshot (default: most recent) into the active list,
-- unchecked, skipping names already on the list. Returns number of items added.
create or replace function public.load_history(history_id uuid default null)
returns int
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
    select distinct on (lower(trim(e->>'name')))
           trim(e->>'name') as name, e->>'quantity' as quantity,
           e->>'notes' as notes, e->>'category' as category
      from jsonb_array_elements(snap) e
     where coalesce(trim(e->>'name'), '') <> ''
  ), ins as (
    insert into public.grocery_items (household_id, list_id, name, quantity, notes, category, added_by)
    select hid, lst.id, s.name, s.quantity, s.notes, s.category, auth.uid()
      from src s
     where not exists (
       select 1 from public.grocery_items gi
        where gi.list_id = lst.id and lower(trim(gi.name)) = lower(s.name))
    returning 1
  )
  select count(*) into added from ins;
  return added;
end
$$;

-- Add a recipe's ingredients to the active list. An ingredient whose name already
-- appears (unchecked) on the list is merged by noting the recipe instead of duplicated.
create or replace function public.add_recipe_to_list(rid uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid := public.current_household_id();
  lst public.grocery_lists;
  rname text;
  ing record;
  existing public.grocery_items;
  added int := 0;
begin
  select name into rname from public.recipes where id = rid and household_id = hid;
  if rname is null then
    raise exception 'recipe not found';
  end if;
  lst := public.ensure_active_list();

  for ing in
    select * from public.recipe_ingredients where recipe_id = rid order by position, name
  loop
    select * into existing from public.grocery_items
     where list_id = lst.id and not checked and lower(trim(name)) = lower(trim(ing.name))
     limit 1;
    if found then
      update public.grocery_items
         set notes = concat_ws('; ', nullif(existing.notes, ''),
                               rname || coalesce(' (' || nullif(ing.quantity, '') || ')', ''))
       where id = existing.id;
    else
      insert into public.grocery_items
        (household_id, list_id, name, quantity, notes, recipe_id, added_by)
      values
        (hid, lst.id, trim(ing.name), ing.quantity,
         concat_ws('; ', nullif(ing.notes, ''), 'for ' || rname), rid, auth.uid());
      added := added + 1;
    end if;
  end loop;
  return added;
end
$$;

-- Quick-add favorites (all, or the given ids) to the active list, skipping duplicates.
create or replace function public.add_favorites_to_list(favorite_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
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
    insert into public.grocery_items (household_id, list_id, name, quantity, notes, category, added_by)
    select hid, lst.id, f.name, f.quantity, f.notes, f.category, auth.uid()
      from public.favorites f
     where f.household_id = hid
       and (favorite_ids is null or f.id = any (favorite_ids))
       and not exists (
         select 1 from public.grocery_items gi
          where gi.list_id = lst.id and not gi.checked
            and lower(trim(gi.name)) = lower(trim(f.name)))
    returning 1
  )
  select count(*) into added from ins;
  return added;
end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.households         enable row level security;
alter table public.users              enable row level security;
alter table public.grocery_lists      enable row level security;
alter table public.grocery_items      enable row level security;
alter table public.recipes            enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.favorites          enable row level security;
alter table public.list_history       enable row level security;

-- households: members read; owner renames. Creation goes through create_household().
create policy households_select on public.households
  for select to authenticated using (id = public.current_household_id());
create policy households_update on public.households
  for update to authenticated
  using (id = public.current_household_id() and public.is_household_owner())
  with check (id = public.current_household_id());

-- users: see your household's members; edit only your own profile.
-- Joining goes through create_household()/join_household().
create policy users_select on public.users
  for select to authenticated using (household_id = public.current_household_id());
create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and household_id = public.current_household_id());
-- Members can leave; the owner can remove members.
create policy users_delete on public.users
  for delete to authenticated
  using (household_id = public.current_household_id()
         and (id = auth.uid() or public.is_household_owner()));

-- Column-level guard: members can only change their display name.
revoke update on public.users from authenticated;
grant update (display_name) on public.users to authenticated;
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;

-- Household-scoped tables: full CRUD for members of the household.
do $$
declare
  t text;
begin
  foreach t in array array['grocery_lists', 'grocery_items', 'recipes',
                           'recipe_ingredients', 'favorites', 'list_history']
  loop
    execute format(
      'create policy %1$s_rw on public.%1$I for all to authenticated
         using (household_id = public.current_household_id())
         with check (household_id = public.current_household_id())', t);
  end loop;
end
$$;

-- Lock down RPCs to signed-in users.
revoke execute on function public.create_household(text, text)      from public, anon;
revoke execute on function public.join_household(text, text)        from public, anon;
revoke execute on function public.regenerate_invite_code()          from public, anon;
revoke execute on function public.ensure_active_list()              from public, anon;
revoke execute on function public.finish_list()                     from public, anon;
revoke execute on function public.load_history(uuid)                from public, anon;
revoke execute on function public.add_recipe_to_list(uuid)          from public, anon;
revoke execute on function public.add_favorites_to_list(uuid[])     from public, anon;
grant execute on function public.create_household(text, text)       to authenticated;
grant execute on function public.join_household(text, text)         to authenticated;
grant execute on function public.regenerate_invite_code()           to authenticated;
grant execute on function public.ensure_active_list()               to authenticated;
grant execute on function public.finish_list()                      to authenticated;
grant execute on function public.load_history(uuid)                 to authenticated;
grant execute on function public.add_recipe_to_list(uuid)           to authenticated;
grant execute on function public.add_favorites_to_list(uuid[])      to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes so every device updates instantly.
-- ---------------------------------------------------------------------------

alter table public.grocery_items      replica identity full;
alter table public.grocery_lists      replica identity full;
alter table public.favorites          replica identity full;
alter table public.recipes            replica identity full;
alter table public.recipe_ingredients replica identity full;
alter table public.list_history       replica identity full;
alter table public.users              replica identity full;

alter publication supabase_realtime add table
  public.grocery_items, public.grocery_lists, public.favorites,
  public.recipes, public.recipe_ingredients, public.list_history, public.users;
