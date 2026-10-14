-- Read-only follow-up for the selected reply-visible talk layout.
-- Existing conversation tables, write/moderation RPCs, data, owners and policies
-- are untouched. This fixed read RPC has the same service-role-only boundary.
-- Reviewed source is prepared offline; installation requires separate evidence.
begin;

create or replace function public.talk_feed_read(
  p_kind text, p_actor uuid default null, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_before bigint;
  v_limit integer;
  v_category text;
  v_query text;
  v_terms text[];
  v_ids bigint[];
  v_rows jsonb;
  v_more boolean;
begin
  if p_kind is null or p_kind not in ('community','stock') or p_data is null
    or jsonb_typeof(p_data)<>'object' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  v_category:=coalesce(p_data->>'category','all');
  if (p_kind='community' and v_category not in ('all','economy','news','life','learn','chat'))
    or (p_kind='stock' and not (v_category ~ '^stock:[0-9][0-9A-Z]{3}$'
      or v_category in ('index:N225','index:SP500','index:DJI','index:IXIC'))) then
    return jsonb_build_object('ok',false,'reason','invalid_category');
  end if;
  v_before:=nullif(p_data->>'before','')::bigint;
  v_limit:=coalesce((p_data->>'limit')::integer,20);
  if v_limit not between 1 and 20
    or (v_before is not null and (v_before<1 or v_before>9007199254740991)) then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  if p_data ? 'query' and jsonb_typeof(p_data->'query')<>'string' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  v_query:=coalesce(p_data->>'query','');
  if char_length(v_query)>80 or v_query ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  -- API normalization collapses all Unicode whitespace before this boundary.
  -- SQL normalizes again; position() treats %, _, quotes and punctuation literally.
  v_query:=btrim(regexp_replace(lower(normalize(v_query,NFKC)), ' +', ' ', 'g'));
  if char_length(v_query)>80 then
    return jsonb_build_object('ok',false,'reason','invalid_request');
  end if;
  v_terms:=case when v_query='' then array[]::text[] else string_to_array(v_query,' ') end;

  if p_kind='community' then
    select array_agg(q.id order by q.id desc) into v_ids from (
      select p.id from public.community_posts p where p.parent_id is null
        and p.deleted_at is null and p.hidden_at is null
        and (v_category='all' or p.category=v_category)
        and (v_before is null or p.id<v_before)
        and (v_query='' or not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(p.name || ' ' || p.body,NFKC)))=0)
          or exists (select 1 from public.community_posts r where r.parent_id=p.id
            and r.category=p.category and r.deleted_at is null and r.hidden_at is null
            and not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(r.name || ' ' || r.body,NFKC)))=0)))
      order by p.id desc limit v_limit+1) q;
    v_more:=coalesce(array_length(v_ids,1),0)>v_limit;
    v_ids:=v_ids[1:v_limit];
    select coalesce(jsonb_agg(
      public.world_community_public_post(p.id,p_actor) || jsonb_build_object(
        'reply_count',(select count(*) from public.community_posts r where r.parent_id=p.id
          and r.category=p.category and r.deleted_at is null and r.hidden_at is null),
        'reply_preview',(select public.world_community_public_post(r.id,p_actor)
          from public.community_posts r where r.parent_id=p.id and r.category=p.category
            and r.deleted_at is null and r.hidden_at is null
            and (v_query='' or not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(p.name || ' ' || p.body,NFKC)))=0) or not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(r.name || ' ' || r.body,NFKC)))=0))
          order by r.id limit 1)) order by p.id desc),'[]'::jsonb)
      into v_rows from public.community_posts p where p.id=any(v_ids)
        and p.parent_id is null and p.deleted_at is null and p.hidden_at is null;
  end if;

  if p_kind='stock' then
    select array_agg(q.id order by q.id desc) into v_ids from (
      select p.id from public.stock_talk_posts p where p.parent_id is null
        and p.deleted_at is null and p.hidden_at is null
        and (v_category='all' or p.category=v_category)
        and (v_before is null or p.id<v_before)
        and (v_query='' or not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(p.name || ' ' || p.body,NFKC)))=0)
          or exists (select 1 from public.stock_talk_posts r where r.parent_id=p.id
            and r.category=p.category and r.deleted_at is null and r.hidden_at is null
            and not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(r.name || ' ' || r.body,NFKC)))=0)))
      order by p.id desc limit v_limit+1) q;
    v_more:=coalesce(array_length(v_ids,1),0)>v_limit;
    v_ids:=v_ids[1:v_limit];
    select coalesce(jsonb_agg(
      public.stock_talk_public_post(p.id,p_actor) || jsonb_build_object(
        'reply_count',(select count(*) from public.stock_talk_posts r where r.parent_id=p.id
          and r.category=p.category and r.deleted_at is null and r.hidden_at is null),
        'reply_preview',(select public.stock_talk_public_post(r.id,p_actor)
          from public.stock_talk_posts r where r.parent_id=p.id and r.category=p.category
            and r.deleted_at is null and r.hidden_at is null
            and (v_query='' or not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(p.name || ' ' || p.body,NFKC)))=0) or not exists (select 1 from unnest(v_terms) as terms(term) where position(term in lower(normalize(r.name || ' ' || r.body,NFKC)))=0))
          order by r.id limit 1)) order by p.id desc),'[]'::jsonb)
      into v_rows from public.stock_talk_posts p where p.id=any(v_ids)
        and p.parent_id is null and p.deleted_at is null and p.hidden_at is null;
  end if;

  return jsonb_build_object('ok',true,'posts',v_rows,'has_more',v_more,
    'next_cursor',case when v_more then v_ids[array_length(v_ids,1)] else null end,
    'query',v_query,'search_version',1);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok',false,'reason','invalid_request');
end;
$$;
revoke all on function public.talk_feed_read(text,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.talk_feed_read(text,uuid,jsonb) to service_role;
commit;
