-- Add a nullable author-name snapshot to new Shorts reservations only.
-- Existing posts keep NULL. This does not change accounts, login settings,
-- ownership checks, storage, quotas, or any existing post's public content.
begin;

do $profile_guard$ begin
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='website_shorts_public_post' and md5(p.prosrc) in ('0d7b00d0b30c2e64533777d0c9a7def1','1cea3eb8833a19ca74c2be5c45c99a0c')) then raise exception 'profile_function_revision_mismatch'; end if;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='website_shorts_operation' and md5(p.prosrc) in ('4420ad3c3602dcf5873df5e3cb44065c','3c295e89d1333e536eb666e47354f620')) then raise exception 'profile_function_revision_mismatch'; end if;
end $profile_guard$;


alter table public.shorts_posts add column if not exists author_name text;
do $$ begin
  if not exists(select 1 from pg_constraint
      where conrelid='public.shorts_posts'::regclass and conname='shorts_author_name_bounds') then
    alter table public.shorts_posts add constraint shorts_author_name_bounds
      check(author_name is null or (char_length(author_name) between 1 and 20
        and author_name !~ U&'[\0001-\001F\007F-\009F]'));
  end if;
end $$;

create or replace function public.website_shorts_public_post(p_id bigint,p_actor uuid)
returns jsonb language sql volatile security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',id,'provider',provider,'title',title,'caption',caption,
    'topic',topic,'video_id',video_id,'file_bytes',file_bytes,'duration_ms',duration_ms,
    'width',width,'height',height,'content_type',content_type,'created_at',created_at,'published_at',published_at,
    'author_name',author_name,'is_mine',coalesce(owner_id=p_actor,false)) from public.shorts_posts where id=p_id;
$$;
revoke all on function public.website_shorts_public_post(bigint,uuid) from public,anon,authenticated;
grant execute on function public.website_shorts_public_post(bigint,uuid) to service_role;

create or replace function public.website_shorts_operation(
  p_action text,p_actor uuid default null,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row public.shorts_posts%rowtype;
  v_now timestamptz;
  v_last timestamptz;
  v_id bigint;
  v_before bigint;
  v_limit integer;
  v_request uuid;
  v_title text;
  v_caption text;
  v_topic text;
  v_provider text;
  v_video text;
  v_bytes bigint;
  v_duration integer;
  v_width integer;
  v_height integer;
  v_hash text;
  v_type text;
  v_author_name text;
  v_ids bigint[];
  v_more boolean;
  v_posts jsonb;
begin
  if p_data is null or jsonb_typeof(p_data)<>'object' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  if p_action in ('mine','create_youtube','reserve_file','complete_file','delete','purged','expired') then
    if p_actor is null or not exists(select 1 from auth.users where id=p_actor and is_anonymous=false) then
      return jsonb_build_object('ok',false,'reason','login_required');
    end if;
  end if;
  if p_action in ('list','mine') then
    v_topic:=coalesce(p_data->>'topic','all');
    v_before:=nullif(p_data->>'before','')::bigint;
    v_limit:=coalesce((p_data->>'limit')::integer,20);
    if v_limit not between 1 and 20 or v_before<1 or
      (v_topic<>'all' and v_topic not in ('#経済入門','#投資','#マーケット','#企業','#家計・節約',
        '#税金','#副業・お金','#年金・老後','#不動産','#暗号資産','#経済ニュース',
        '#世界経済','#経済史','#行動経済学','#テクノロジーと経済','#用語解説')) then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    select array_agg(q.id order by q.id desc) into v_ids from (
      select id from public.shorts_posts where
        ((p_action='list' and published_at is not null and deleted_at is null and hidden_at is null
          and (v_topic='all' or topic=v_topic))
         or (p_action='mine' and owner_id=p_actor and (deleted_at is null or (provider='upload' and purged_at is null))))
        and (v_before is null or id<v_before) order by id desc limit v_limit+1) q;
    v_more:=coalesce(array_length(v_ids,1),0)>v_limit;
    v_ids:=v_ids[1:v_limit];
    select coalesce(jsonb_agg(public.website_shorts_public_post(i,p_actor)
      || case when p_action='mine' then jsonb_build_object('state',
         case when p.deleted_at is not null then 'deleted' when p.published_at is null then 'pending'
              when p.hidden_at is not null then 'hidden' else 'published' end) else '{}'::jsonb end order by ord),'[]'::jsonb)
      into v_posts from unnest(v_ids) with ordinality as x(i,ord) join public.shorts_posts p on p.id=i;
    return jsonb_build_object('ok',true,'posts',v_posts,'has_more',v_more,
      'next_cursor',case when v_more then v_ids[array_length(v_ids,1)] else null end);
  end if;
  if p_action in ('create_youtube','reserve_file') then
    v_request:=(p_data->>'request_id')::uuid;
    v_title:=btrim(coalesce(p_data->>'title',''));
    v_caption:=btrim(coalesce(p_data->>'caption',''));
    v_topic:=p_data->>'topic';
    v_provider:=case when p_action='create_youtube' then 'youtube' else 'upload' end;
    v_video:=p_data->>'video_id';
    v_hash:=p_data->>'sha256';
    v_bytes:=(p_data->>'file_bytes')::bigint;
    v_duration:=(p_data->>'duration_ms')::integer;
    v_width:=(p_data->>'width')::integer;
    v_height:=(p_data->>'height')::integer;
    v_type:=p_data->>'content_type';
    if v_request is null or v_request='00000000-0000-0000-0000-000000000000'::uuid
      or char_length(v_title) not between 1 and 120 or char_length(v_caption)>280
      or v_topic is null or v_topic not in ('#経済入門','#投資','#マーケット','#企業','#家計・節約',
        '#税金','#副業・お金','#年金・老後','#不動産','#暗号資産','#経済ニュース',
        '#世界経済','#経済史','#行動経済学','#テクノロジーと経済','#用語解説') then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    if v_provider='youtube' and (v_video is null or v_video !~ '^[A-Za-z0-9_-]{11}$') then
      return jsonb_build_object('ok',false,'reason','invalid_url');
    end if;
    if v_provider='upload' and (v_hash is null or v_hash !~ '^[0-9a-f]{64}$' or v_bytes is null
      or v_bytes not between 32 and 20000000 or v_duration is null or v_duration not between 1 and 180000
      or v_width is null or v_width not between 1 and 3840 or v_height is null or v_height not between 1 and 3840
      or v_type is null or v_type not in ('video/mp4','video/quicktime')) then
      return jsonb_build_object('ok',false,'reason','invalid_file');
    end if;
    -- Short metadata-only transaction serialises quota reservations across all
    -- workers. Upload bytes are sent after releasing this transaction lock.
    perform pg_advisory_xact_lock(hashtextextended('website-shorts:quota',0));
    select * into v_row from public.shorts_posts where owner_id=p_actor and request_id=v_request;
    if found then
      if v_row.provider<>v_provider or v_row.title<>v_title or v_row.caption<>v_caption or v_row.topic<>v_topic
        or v_row.video_id is distinct from v_video or v_row.sha256 is distinct from v_hash
        or v_row.file_bytes is distinct from v_bytes or v_row.duration_ms is distinct from v_duration
        or v_row.width is distinct from v_width or v_row.height is distinct from v_height
        or v_row.content_type is distinct from v_type then
        return jsonb_build_object('ok',false,'reason','request_conflict');
      end if;
      if v_row.deleted_at is not null then return jsonb_build_object('ok',false,'reason','post_unavailable'); end if;
      if v_provider='upload' and v_row.published_at is null then
        update public.shorts_posts set upload_count=upload_count+1,
          upload_lease_until=clock_timestamp()+interval '10 minutes' where id=v_row.id;
      end if;
      return jsonb_build_object('ok',true,'published',v_row.published_at is not null,'post_id',v_row.id,
        'object_path',v_row.object_path,'post',public.website_shorts_public_post(v_row.id,p_actor));
    end if;
    v_now:=clock_timestamp();
    select last_post_at into v_last from public.shorts_post_limits where owner_id=p_actor;
    if v_last is not null and v_now-v_last<interval '10 seconds' then
      return jsonb_build_object('ok',false,'reason','rate_limited','retry_after',10);
    end if;
    if (select count(*) from public.shorts_posts where owner_id=p_actor and deleted_at is null)>=200
      or (select count(*) from public.shorts_posts where deleted_at is null)>=5000 then
      return jsonb_build_object('ok',false,'reason','quota_exceeded');
    end if;
    if v_provider='upload' and (
      (select coalesce(sum(file_bytes),0) from public.shorts_posts where provider='upload' and purged_at is null)+v_bytes>500000000
      or (select coalesce(sum(file_bytes),0) from public.shorts_posts where provider='upload' and owner_id=p_actor and purged_at is null)+v_bytes>100000000
      or (select count(*) from public.shorts_posts where provider='upload' and owner_id=p_actor and purged_at is null)>=10) then
      return jsonb_build_object('ok',false,'reason','quota_exceeded');
    end if;
    -- Snapshot only the owner's explicitly saved public username. No display
    -- name is taken from browser input or inferred from email/provider names.
    -- Existing reservations return above, so a retry keeps its first snapshot.
    select case
      when jsonb_typeof(raw_user_meta_data->'kn_profile_v1'->'username')='string'
      then btrim(raw_user_meta_data->'kn_profile_v1'->>'username')
      end into v_author_name
      from auth.users where id=p_actor and is_anonymous=false;
    if char_length(v_author_name) not between 1 and 20
      or v_author_name ~ U&'[\0001-\001F\007F-\009F]' then
      v_author_name:=null;
    end if;
    insert into public.shorts_posts(owner_id,request_id,provider,title,caption,topic,video_id,author_name,
      object_path,sha256,file_bytes,duration_ms,width,height,content_type,published_at,upload_count,upload_lease_until)
      values(p_actor,v_request,v_provider,v_title,v_caption,v_topic,v_video,v_author_name,
        case when v_provider='upload' then p_actor::text||'/'||gen_random_uuid()::text||case when v_type='video/quicktime' then '.mov' else '.mp4' end end,
        v_hash,v_bytes,v_duration,v_width,v_height,v_type,case when v_provider='youtube' then v_now end,
        case when v_provider='upload' then 1 else 0 end,
        case when v_provider='upload' then v_now+interval '10 minutes' end)
      returning * into v_row;
    insert into public.shorts_post_limits(owner_id,last_post_at) values(p_actor,v_now)
      on conflict(owner_id) do update set last_post_at=excluded.last_post_at;
    return jsonb_build_object('ok',true,'published',v_row.published_at is not null,'post_id',v_row.id,
      'object_path',v_row.object_path,'post',public.website_shorts_public_post(v_row.id,p_actor));
  end if;
  if p_action='expired' then
    return jsonb_build_object('ok',true,'assets',(select coalesce(jsonb_agg(jsonb_build_object(
      'post_id',id,'object_path',object_path)),'[]'::jsonb) from (select id,object_path from public.shorts_posts
      where owner_id=p_actor and provider='upload' and purged_at is null
        and (upload_count=0 or upload_lease_until<clock_timestamp())
        and (deleted_at is not null or (published_at is null and created_at<clock_timestamp()-interval '1 hour'))
      order by id limit 2) q));
  end if;
  v_id:=(p_data->>'post_id')::bigint;
  if v_id is null or v_id<1 or v_id>9007199254740991 then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  if p_action in ('complete_file','delete','purged') then
    perform pg_advisory_xact_lock(hashtextextended('website-shorts:quota',0));
    select * into v_row from public.shorts_posts where id=v_id and owner_id=p_actor for update;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    if p_action='complete_file' then
      if v_row.provider<>'upload' or v_row.sha256 is distinct from p_data->>'sha256' then
        return jsonb_build_object('ok',false,'reason','request_conflict');
      end if;
      update public.shorts_posts set upload_count=greatest(0,upload_count-1) where id=v_id;
      if v_row.deleted_at is not null then
        return jsonb_build_object('ok',true,'cancelled',true,
          'cleanup_pending',v_row.upload_count>1,
          'object_path',case when v_row.upload_count<=1 then v_row.object_path end);
      end if;
      update public.shorts_posts set published_at=coalesce(published_at,clock_timestamp()) where id=v_id;
      return jsonb_build_object('ok',true,'post',public.website_shorts_public_post(v_id,p_actor));
    end if;
    if p_action='delete' then
      update public.shorts_posts set deleted_at=coalesce(deleted_at,clock_timestamp()) where id=v_id;
      return jsonb_build_object('ok',true,
        'cleanup_pending',v_row.provider='upload' and v_row.purged_at is null
          and v_row.upload_count>0 and v_row.upload_lease_until>=clock_timestamp(),
        'object_path',case when v_row.provider='upload' and v_row.purged_at is null
          and (v_row.upload_count=0 or v_row.upload_lease_until<clock_timestamp()) then v_row.object_path end);
    end if;
    if v_row.deleted_at is null or v_row.provider<>'upload' then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    if v_row.upload_count>0 and v_row.upload_lease_until>=clock_timestamp() then
      return jsonb_build_object('ok',false,'reason','request_conflict');
    end if;
    update public.shorts_posts set purged_at=coalesce(purged_at,clock_timestamp()) where id=v_id;
    return jsonb_build_object('ok',true);
  end if;
  if p_action='media' then
    select * into v_row from public.shorts_posts where id=v_id and provider='upload'
      and published_at is not null and deleted_at is null and hidden_at is null;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    return jsonb_build_object('ok',true,'object_path',v_row.object_path);
  end if;
  if p_action='moderate' then
    if jsonb_typeof(p_data->'hidden') is distinct from 'boolean' then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    update public.shorts_posts set hidden_at=case when (p_data->>'hidden')::boolean
      then coalesce(hidden_at,clock_timestamp()) else null end where id=v_id and deleted_at is null;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    return jsonb_build_object('ok',true);
  end if;
  return jsonb_build_object('ok',false,'reason','invalid_request');
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  return jsonb_build_object('ok',false,'reason','invalid_request');
end;
$$;
revoke all on function public.website_shorts_operation(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.website_shorts_operation(text,uuid,jsonb) to service_role;
commit;
