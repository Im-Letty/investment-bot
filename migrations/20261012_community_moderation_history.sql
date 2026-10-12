-- Prepared follow-up: open/resolved moderation report lists and restore access.
-- Replaces only the existing RPC body, with the same signature and SECURITY
-- DEFINER/search_path. CREATE OR REPLACE retains its existing owner and ACL.
-- No grants, roles, RLS policies, secrets, tables or public writes are changed.
begin;

create or replace function public.world_community_operation(
  p_action text, p_actor uuid default null, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_post public.community_posts%rowtype;
  v_existing public.community_posts%rowtype;
  v_parent public.community_posts%rowtype;
  v_now timestamptz;
  v_last timestamptz;
  v_id bigint;
  v_before bigint;
  v_after bigint;
  v_parent_id bigint;
  v_request uuid;
  v_limit integer;
  v_category text;
  v_language text;
  v_name text;
  v_body text;
  v_reason text;
  v_report_status text;
  v_liked boolean;
  v_ids bigint[];
  v_rows jsonb;
  v_more boolean;
begin
  if p_data is null or jsonb_typeof(p_data)<>'object' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  if p_action in ('create','delete','report','like') and p_actor is null then
    return jsonb_build_object('ok',false,'reason','auth_required');
  end if;

  if p_action='list' then
    v_category:=coalesce(p_data->>'category','all');
    if v_category not in ('all','economy','news','life','learn','chat') then
      return jsonb_build_object('ok',false,'reason','invalid_category');
    end if;
    v_before:=nullif(p_data->>'before','')::bigint;
    v_limit:=coalesce((p_data->>'limit')::integer,20);
    if v_limit not between 1 and 20 or (v_before is not null and v_before<1) then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    select array_agg(q.id order by q.id desc) into v_ids from (
      select p.id from public.community_posts p where p.parent_id is null
        and p.deleted_at is null and p.hidden_at is null
        and (v_category='all' or p.category=v_category)
        and (v_before is null or p.id<v_before)
      order by p.id desc limit v_limit+1) q;
    v_more:=coalesce(array_length(v_ids,1),0)>v_limit;
    v_ids:=v_ids[1:v_limit];
    select coalesce(jsonb_agg(public.world_community_public_post(i,p_actor) order by ord),'[]'::jsonb)
      into v_rows from unnest(v_ids) with ordinality as x(i,ord);
    return jsonb_build_object('ok',true,'posts',v_rows,'has_more',v_more,
      'next_cursor',case when v_more then v_ids[array_length(v_ids,1)] else null end);
  end if;

  if p_action='replies' then
    v_id:=(p_data->>'post_id')::bigint;
    select * into v_parent from public.community_posts where id=v_id
      and parent_id is null and deleted_at is null and hidden_at is null;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    v_after:=nullif(p_data->>'after','')::bigint;
    v_limit:=coalesce((p_data->>'limit')::integer,50);
    if v_limit not between 1 and 50 or (v_after is not null and v_after<1) then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    select array_agg(q.id order by q.id) into v_ids from (
      select p.id from public.community_posts p where p.parent_id=v_id
        and p.deleted_at is null and p.hidden_at is null
        and (v_after is null or p.id>v_after)
      order by p.id limit v_limit+1) q;
    v_more:=coalesce(array_length(v_ids,1),0)>v_limit;
    v_ids:=v_ids[1:v_limit];
    select coalesce(jsonb_agg(public.world_community_public_post(i,p_actor) order by ord),'[]'::jsonb)
      into v_rows from unnest(v_ids) with ordinality as x(i,ord);
    return jsonb_build_object('ok',true,'posts',v_rows,'has_more',v_more,
      'next_cursor',case when v_more then v_ids[array_length(v_ids,1)] else null end);
  end if;

  if p_action='create' then
    v_name:=btrim(coalesce(p_data->>'name',''));
    v_body:=btrim(coalesce(p_data->>'body',''));
    v_category:=p_data->>'category';
    v_language:=p_data->>'language';
    v_parent_id:=(p_data->>'parent_id')::bigint;
    v_request:=(p_data->>'request_id')::uuid;
    if char_length(v_name) not between 1 and 20 then
      return jsonb_build_object('ok',false,'reason','invalid_name');
    end if;
    if char_length(v_body)=0 then return jsonb_build_object('ok',false,'reason','empty'); end if;
    if char_length(v_body)>200 then return jsonb_build_object('ok',false,'reason','too_long'); end if;
    if v_request is null then return jsonb_build_object('ok',false,'reason','invalid_request_id'); end if;
    if v_category is null or v_category not in ('economy','news','life','learn','chat') then
      return jsonb_build_object('ok',false,'reason','invalid_category');
    end if;
    if v_language is null or v_language not in ('ja','en','ko','zh','other') then
      return jsonb_build_object('ok',false,'reason','invalid_language');
    end if;
    -- One per-user transaction lock protects both idempotency and the 10s limit
    -- across workers/restarts. Unrelated people can post concurrently.
    perform pg_advisory_xact_lock(hashtextextended('world-community:create:'||p_actor::text,0));
    if v_parent_id is not null then
      select * into v_parent from public.community_posts where id=v_parent_id
        and parent_id is null and deleted_at is null and hidden_at is null for share;
      if not found then return jsonb_build_object('ok',false,'reason','invalid_parent'); end if;
      v_category:=v_parent.category;
    end if;
    select * into v_existing from public.community_posts
      where user_id=p_actor and request_id=v_request;
    if found then
      if v_existing.deleted_at is not null or v_existing.hidden_at is not null then
        return jsonb_build_object('ok',false,'reason','post_unavailable');
      end if;
      if v_existing.name<>v_name or v_existing.body<>v_body or v_existing.category<>v_category
        or v_existing.language<>v_language or v_existing.parent_id is distinct from v_parent_id then
        return jsonb_build_object('ok',false,'reason','request_conflict');
      end if;
      return jsonb_build_object('ok',true,'post',public.world_community_public_post(v_existing.id,p_actor));
    end if;
    v_now:=clock_timestamp();
    select last_post_at into v_last from public.community_post_limits where user_id=p_actor;
    if found and v_last>v_now-interval '10 seconds' then
      return jsonb_build_object('ok',false,'reason','rate_limited',
        'retry_after',greatest(1,ceil(extract(epoch from (v_last+interval '10 seconds'-v_now)))::integer));
    end if;
    insert into public.community_posts(user_id,request_id,name,body,category,language,parent_id)
      values(p_actor,v_request,v_name,v_body,v_category,v_language,v_parent_id) returning * into v_post;
    insert into public.community_post_limits(user_id,last_post_at) values(p_actor,v_now)
      on conflict(user_id) do update set last_post_at=excluded.last_post_at;
    return jsonb_build_object('ok',true,'post',public.world_community_public_post(v_post.id,p_actor));
  end if;

  if p_action='delete' then
    v_id:=(p_data->>'post_id')::bigint;
    select * into v_post from public.community_posts where id=v_id and user_id=p_actor for update;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    update public.community_posts set deleted_at=coalesce(deleted_at,clock_timestamp()) where id=v_id;
    return jsonb_build_object('ok',true);
  end if;

  if p_action in ('report','like') then
    v_id:=(p_data->>'post_id')::bigint;
    select * into v_post from public.community_posts where id=v_id
      and deleted_at is null and hidden_at is null for share;
    if not found or (v_post.parent_id is not null and not exists(
      select 1 from public.community_posts root where root.id=v_post.parent_id
        and root.parent_id is null and root.deleted_at is null and root.hidden_at is null)) then
      return jsonb_build_object('ok',false,'reason','not_found');
    end if;
    if p_action='report' then
      v_reason:=p_data->>'reason';
      if v_reason is null or v_reason not in ('spam','abuse','privacy','misinformation','other') then
        return jsonb_build_object('ok',false,'reason','invalid_reason');
      end if;
      insert into public.community_reports(post_id,user_id,reason) values(v_id,p_actor,v_reason)
        on conflict(post_id,user_id) do nothing;
      return jsonb_build_object('ok',true);
    end if;
    if jsonb_typeof(p_data->'liked') is distinct from 'boolean' then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    v_liked:=(p_data->>'liked')::boolean;
    perform pg_advisory_xact_lock(hashtextextended('world-community:reaction:'||v_id||':'||p_actor::text,0));
    if v_liked then
      insert into public.community_reactions(post_id,user_id) values(v_id,p_actor)
        on conflict(post_id,user_id) do nothing;
    else
      delete from public.community_reactions where post_id=v_id and user_id=p_actor;
    end if;
    return jsonb_build_object('ok',true,'liked',v_liked,
      'like_count',(select count(*) from public.community_reactions where post_id=v_id));
  end if;

  -- The application exposes these only behind its existing administrator check.
  -- The RPC itself is service-role-only, including these two actions.
  if p_action='report_list' then
    v_report_status:=coalesce(p_data->>'status','open');
    v_limit:=coalesce((p_data->>'limit')::integer,50);
    v_after:=nullif(p_data->>'cursor','')::bigint;
    if v_report_status not in ('open','resolved') or v_limit not between 1 and 50
      or (v_after is not null and v_after<1) then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    select array_agg(q.id order by case when v_report_status='open' then q.id end asc,
      case when v_report_status='resolved' then q.id end desc) into v_ids from (
      select r.id from public.community_reports r
      where ((v_report_status='open' and r.resolved_at is null)
          or (v_report_status='resolved' and r.resolved_at is not null))
        and (v_after is null or (v_report_status='open' and r.id>v_after)
          or (v_report_status='resolved' and r.id<v_after))
      order by case when v_report_status='open' then r.id end asc,
        case when v_report_status='resolved' then r.id end desc limit v_limit+1) q;
    v_more:=coalesce(array_length(v_ids,1),0)>v_limit;
    v_ids:=v_ids[1:v_limit];
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'post_id',q.post_id,
      'reason',q.reason,'created_at',q.created_at,'resolved_at',q.resolved_at,'post',q.post)
      order by q.ord),'[]'::jsonb) into v_rows from (
      select r.id,r.post_id,r.reason,r.created_at,r.resolved_at,x.ord,jsonb_build_object(
        'id',p.id,'name',p.name,'body',p.body,'category',p.category,'language',p.language,
        'created_at',p.created_at,'hidden',p.hidden_at is not null,'deleted',p.deleted_at is not null) as post
      from unnest(v_ids) with ordinality as x(i,ord)
      join public.community_reports r on r.id=x.i join public.community_posts p on p.id=r.post_id) q;
    return jsonb_build_object('ok',true,'status',v_report_status,'reports',v_rows,
      'has_more',v_more,'next_cursor',case when v_more then v_ids[array_length(v_ids,1)] else null end);
  end if;
  if p_action='moderate' then
    v_id:=(p_data->>'post_id')::bigint;
    if jsonb_typeof(p_data->'hidden') is distinct from 'boolean' then
      return jsonb_build_object('ok',false,'reason','invalid_request');
    end if;
    update public.community_posts set hidden_at=case when (p_data->>'hidden')::boolean
      then coalesce(hidden_at,clock_timestamp()) else null end where id=v_id;
    if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
    update public.community_reports set resolved_at=coalesce(resolved_at,clock_timestamp()) where post_id=v_id;
    return jsonb_build_object('ok',true);
  end if;
  return jsonb_build_object('ok',false,'reason','invalid_request');
end;
$$;

notify pgrst, 'reload schema';
commit;
