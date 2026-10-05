-- Family calendar: one row per event, shared by the whole household.

create table public.events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title        text not null check (length(trim(title)) > 0),
  description  text,
  date         date not null,
  time         time without time zone,
  event_type   text check (event_type is null or length(trim(event_type)) between 1 and 40),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index events_household_date_idx on public.events (household_id, date);

create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- The creator is whoever inserted the row, and edits never change it.
create or replace function public.events_keep_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;
create trigger events_keep_creator before insert or update on public.events
  for each row execute function public.events_keep_creator();

-- Everyone in the household can view, create, edit and delete its events.
alter table public.events enable row level security;
create policy events_rw on public.events for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

alter table public.events replica identity full;
alter publication supabase_realtime add table public.events;
