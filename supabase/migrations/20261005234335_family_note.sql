create table if not exists public.family_note (
  household_id uuid primary key references public.households(id) on delete cascade,
  body text not null default '' check (length(body) <= 500),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now()
);

alter table public.family_note enable row level security;

create policy family_note_rw on public.family_note
  for all to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

grant select, insert, update, delete on public.family_note to authenticated;

alter publication supabase_realtime add table public.family_note;

revoke all on public.family_note from anon;
revoke truncate, references, trigger on public.family_note from authenticated;
