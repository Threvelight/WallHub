-- Private photo storage for the Today screen photo frame.
-- Files live under <household_id>/<file name>, so each household only sees its own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('household-photos', 'household-photos', false, 2097152, array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

create policy household_photos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'household-photos' and (storage.foldername(name))[1] = public.current_household_id()::text);

create policy household_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'household-photos' and (storage.foldername(name))[1] = public.current_household_id()::text);

-- Anyone can remove a photo they added; the household owner can remove any photo.
create policy household_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'household-photos'
    and (storage.foldername(name))[1] = public.current_household_id()::text
    and (owner = auth.uid() or public.is_household_owner())
  );
