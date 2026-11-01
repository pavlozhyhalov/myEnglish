-- Короткі аудіофрагменти голосових розмов (для звіту «місяць тому → зараз»).
-- Приватний бакет: кожен користувач бачить, пише й видаляє лише файли у власній теці <uid>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-clips', 'voice-clips', false, 1048576, array['audio/wav'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'voice_clips_select_own') then
    create policy voice_clips_select_own on storage.objects for select to authenticated
      using (bucket_id = 'voice-clips' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'voice_clips_insert_own') then
    create policy voice_clips_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'voice-clips' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'voice_clips_delete_own') then
    create policy voice_clips_delete_own on storage.objects for delete to authenticated
      using (bucket_id = 'voice-clips' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $$;
