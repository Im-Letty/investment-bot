-- Private, owner-bound profile images. No public/browser Storage access.
-- Apply only to the existing project after reviewing this candidate migration.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('website-profile-avatars','website-profile-avatars',false,49152,array['image/jpeg'])
  on conflict(id) do nothing;

-- Do not silently reuse a bucket with incompatible privacy or size settings.
do $$ begin
  if not exists(select 1 from storage.buckets where id='website-profile-avatars'
      and public=false and file_size_limit=49152
      and allowed_mime_types=array['image/jpeg']) then
    raise exception 'profile_avatar_bucket_configuration_mismatch';
  end if;
end $$;

-- The service-role backend checks Auth's self-user endpoint first and constructs
-- owner/hash.jpg itself. Restrictive policy also blocks broad existing policies;
-- for every other bucket this expression is true and changes no access.
drop policy if exists website_profile_avatars_server_only on storage.objects;
create policy website_profile_avatars_server_only on storage.objects as restrictive
  for all to anon, authenticated
  using(bucket_id<>'website-profile-avatars')
  with check(bucket_id<>'website-profile-avatars');

commit;
