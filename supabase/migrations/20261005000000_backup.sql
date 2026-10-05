-- Backups: list snapshots keep each item's category name, and a weekly job
-- emails the week's finalized lists (Edge Function weekly-backup).

-- ---------------------------------------------------------------------------
-- Snapshots carry the category name, so backups and restores keep it.
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
           'category', coalesce(c.name, gi.category), 'checked', gi.checked) order by gi.created_at), '[]'::jsonb)
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
-- Weekly backup email
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Not exposed through the API. Holds the shared secret the schedule sends to
-- the Edge Function, and where the function lives.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.backup_config (
  id           boolean primary key default true check (id),
  token        text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  function_url text not null
);
insert into private.backup_config (function_url)
values ('https://orhikiawxqterdnwomdm.supabase.co/functions/v1/weekly-backup')
on conflict (id) do nothing;

-- The Edge Function (service role) checks the caller's token with this.
create or replace function public.backup_token_ok(t text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.backup_config where token = t and length(t) > 0)
$$;
revoke execute on function public.backup_token_ok(text) from public, anon, authenticated;
grant execute on function public.backup_token_ok(text) to service_role;

-- Calls the Edge Function. Used by the schedule, and handy for a manual run:
--   select private.run_weekly_backup();          -- sends
--   select private.run_weekly_backup(true);      -- dry run (see net._http_response)
create or replace function private.run_weekly_backup(dry_run boolean default false)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := c.function_url || case when dry_run then '?dry_run=1' else '' end,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.token),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  from private.backup_config c
$$;
revoke execute on function private.run_weekly_backup(boolean) from public, anon, authenticated;

-- Sunday 8 PM in Phoenix (UTC-7, no daylight saving) is Monday 03:00 UTC.
select cron.unschedule('wallhub-weekly-backup')
 where exists (select 1 from cron.job where jobname = 'wallhub-weekly-backup');
select cron.schedule('wallhub-weekly-backup', '0 3 * * 1', 'select private.run_weekly_backup()');
