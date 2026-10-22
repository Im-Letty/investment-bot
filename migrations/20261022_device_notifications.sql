-- Preparation only: applying this migration is a separate deployment action.
-- No authentication settings, extensions, schedules or billing are changed.
begin;
create table if not exists public.device_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 endpoint_hash text not null unique check(endpoint_hash ~ '^[0-9a-f]{64}$'),
 subscription jsonb not null,
 active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table if not exists public.device_reminders (
 owner_id uuid not null references auth.users(id) on delete cascade,
 task_id text not null check(task_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 due_at timestamptz not null,
 timezone text not null,
 revision bigint not null default 1 check(revision>0),
 occurrence_id uuid not null default gen_random_uuid(),
 state text not null default 'scheduled' check(state in ('scheduled','dispatched','expired')),
 updated_at timestamptz not null default now(),
 primary key(owner_id,task_id)
);
create table if not exists public.device_push_jobs (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null,
 task_id text not null,
 occurrence_id uuid not null,
 subscription_id uuid not null references public.device_push_subscriptions(id) on delete cascade,
 state text not null default 'pending' check(state in ('pending','claimed','sent','expired','unavailable')),
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 unique(occurrence_id,subscription_id),
 foreign key(owner_id,task_id) references public.device_reminders(owner_id,task_id) on delete cascade
);
create table if not exists public.device_price_rule_drafts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 symbol text not null,
 rule jsonb not null check(rule->'enabled'='false'::jsonb),
 updated_at timestamptz not null default now(),
 primary key(owner_id,symbol)
);
alter table public.device_push_subscriptions enable row level security;
alter table public.device_reminders enable row level security;
alter table public.device_push_jobs enable row level security;
alter table public.device_price_rule_drafts enable row level security;
revoke all on public.device_push_subscriptions,public.device_reminders,
 public.device_push_jobs,public.device_price_rule_drafts from public,anon,authenticated;
create index if not exists device_reminders_due on public.device_reminders(due_at) where state='scheduled';
create index if not exists device_push_pending on public.device_push_jobs(created_at) where state='pending';

create or replace function public.device_notifications_operation(
 p_action text,p_actor uuid default null,p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 sub public.device_push_subscriptions%rowtype;
 reminder public.device_reminders%rowtype;
 version bigint;
 rows jsonb;
 job record;
begin
 if p_action not in ('status','subscribe','unsubscribe','schedule','cancel','price_draft','claim','check_claim','finish')
 or jsonb_typeof(p_data)<>'object' then
  return jsonb_build_object('ok',false,'reason','invalid_request');
 end if;
 if p_action not in ('claim','check_claim','finish') then
  if p_actor is null then return jsonb_build_object('ok',false,'reason','auth_required'); end if;
  -- Serialize per-owner quota checks and edits across browser tabs/worker processes.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,7291));
 end if;
 if p_action='status' then
  select coalesce(jsonb_agg(jsonb_build_object(
   'task_id',r.task_id,'due_at',r.due_at,'timezone',r.timezone,'revision',r.revision,'state',r.state
  ) order by r.updated_at desc),'[]'::jsonb) into rows
  from public.device_reminders r where r.owner_id=p_actor;
  return jsonb_build_object('ok',true,'reminders',rows,'subscription_count',
   (select count(*) from public.device_push_subscriptions where owner_id=p_actor and active));
 elsif p_action='subscribe' then
  if p_data->>'endpoint_hash' !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_data->'subscription')<>'object' then
   return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  -- Also serialize the globally unique endpoint so an account switch cannot transfer ownership.
  perform pg_advisory_xact_lock(hashtextextended(p_data->>'endpoint_hash',7292));
  select * into sub from public.device_push_subscriptions where endpoint_hash=p_data->>'endpoint_hash' for update;
  if found and sub.owner_id<>p_actor then return jsonb_build_object('ok',false,'reason','conflict'); end if;
  if (not found or not sub.active) and (select count(*) from public.device_push_subscriptions where owner_id=p_actor and active)>=5 then
   return jsonb_build_object('ok',false,'reason','limit_reached'); end if;
  insert into public.device_push_subscriptions(owner_id,endpoint_hash,subscription)
   values(p_actor,p_data->>'endpoint_hash',p_data->'subscription')
   on conflict(endpoint_hash) do update set subscription=excluded.subscription,active=true,updated_at=now();
  return jsonb_build_object('ok',true);
 elsif p_action='unsubscribe' then
  delete from public.device_push_subscriptions where owner_id=p_actor and endpoint_hash=p_data->>'endpoint_hash';
  return jsonb_build_object('ok',true);
 elsif p_action='schedule' then
  if p_data->>'task_id' !~ '^[A-Za-z0-9_-]{1,80}$'
   or (p_data->>'due_at')::timestamptz<=now()
   or (p_data->>'due_at')::timestamptz>now()+interval '367 days'
   or not exists(select 1 from public.device_push_subscriptions where owner_id=p_actor and active)
   then return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  select * into reminder from public.device_reminders where owner_id=p_actor and task_id=p_data->>'task_id' for update;
  if coalesce(reminder.revision,0)<>(p_data->>'expected_revision')::bigint then
   return jsonb_build_object('ok',false,'reason','conflict'); end if;
  if reminder.revision is null and (select count(*) from public.device_reminders where owner_id=p_actor)>=100 then
   return jsonb_build_object('ok',false,'reason','limit_reached'); end if;
  version=coalesce(reminder.revision,0)+1;
  -- Rescheduling retires all previous unsent claims. A handed-off push cannot be recalled.
  delete from public.device_push_jobs where owner_id=p_actor and task_id=p_data->>'task_id';
  insert into public.device_reminders(owner_id,task_id,due_at,timezone,revision)
   values(p_actor,p_data->>'task_id',(p_data->>'due_at')::timestamptz,p_data->>'timezone',version)
   on conflict(owner_id,task_id) do update set due_at=excluded.due_at,timezone=excluded.timezone,
    revision=excluded.revision,occurrence_id=gen_random_uuid(),state='scheduled',updated_at=now();
  return jsonb_build_object('ok',true,'revision',version);
 elsif p_action='cancel' then
  delete from public.device_reminders where owner_id=p_actor and task_id=p_data->>'task_id';
  return jsonb_build_object('ok',true);
 elsif p_action='price_draft' then
  if p_data->'enabled' is distinct from 'false'::jsonb then
   return jsonb_build_object('ok',false,'reason','price_source_unverified'); end if;
  if p_data->>'symbol' !~ '^[0-9A-Z]{4}\.T$' then
   return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  if not exists(select 1 from public.device_price_rule_drafts where owner_id=p_actor and symbol=p_data->>'symbol')
    and (select count(*) from public.device_price_rule_drafts where owner_id=p_actor)>=50 then
   return jsonb_build_object('ok',false,'reason','limit_reached'); end if;
  insert into public.device_price_rule_drafts(owner_id,symbol,rule) values(p_actor,p_data->>'symbol',p_data)
   on conflict(owner_id,symbol) do update set rule=excluded.rule,updated_at=now();
  return jsonb_build_object('ok',true);
 elsif p_action='claim' then
  -- Late jobs are explicitly expired; never send a backlog as if it were timely.
  update public.device_reminders set state='expired',updated_at=now()
   where state='scheduled' and due_at<now()-interval '1 hour';
  for reminder in select * from public.device_reminders
   where state='scheduled' and due_at<=now() order by due_at limit 20 for update skip locked
  loop
   insert into public.device_push_jobs(owner_id,task_id,occurrence_id,subscription_id)
    select reminder.owner_id,reminder.task_id,reminder.occurrence_id,id
    from public.device_push_subscriptions where owner_id=reminder.owner_id and active
    on conflict(occurrence_id,subscription_id) do nothing;
   update public.device_reminders set state='dispatched',updated_at=now()
    where owner_id=reminder.owner_id and task_id=reminder.task_id;
  end loop;
  rows='[]'::jsonb;
  for job in select j.id,j.owner_id,j.task_id,j.occurrence_id,s.subscription
   from public.device_push_jobs j
   join public.device_reminders r on r.owner_id=j.owner_id and r.task_id=j.task_id and r.occurrence_id=j.occurrence_id
   join public.device_push_subscriptions s on s.id=j.subscription_id and s.active
   where j.state='pending' and r.state='dispatched'
    and r.due_at>=now()-interval '1 hour'
   order by j.created_at limit 20 for update of j skip locked
  loop
   update public.device_push_jobs set state='claimed' where id=job.id;
   rows=rows||jsonb_build_array(jsonb_build_object('id',job.id,'owner_id',job.owner_id,
    'task_id',job.task_id,'occurrence_id',job.occurrence_id,'subscription',job.subscription));
  end loop;
  return jsonb_build_object('ok',true,'jobs',rows);
 elsif p_action='check_claim' then
  return jsonb_build_object('ok',true,'send',exists(
   select 1 from public.device_push_jobs j
   join public.device_reminders r on r.owner_id=j.owner_id and r.task_id=j.task_id and r.occurrence_id=j.occurrence_id
   join public.device_push_subscriptions s on s.id=j.subscription_id and s.active
   where j.id=(p_data->>'id')::uuid and j.state='claimed'
    and r.state='dispatched' and r.due_at>=now()-interval '1 hour'));
 else
  if p_data->>'outcome' not in ('sent','expired','unavailable') then
   return jsonb_build_object('ok',false,'reason','invalid_request'); end if;
  update public.device_push_jobs set state=p_data->>'outcome',finished_at=now()
   where id=(p_data->>'id')::uuid and state='claimed';
  if p_data->>'outcome'='expired' then
   update public.device_push_subscriptions set active=false,updated_at=now()
    where id=(select subscription_id from public.device_push_jobs where id=(p_data->>'id')::uuid);
  end if;
  return jsonb_build_object('ok',true);
 end if;
exception when others then
 -- No provider URL, token, original SQL error or personal content leaves this RPC.
 return jsonb_build_object('ok',false,'reason','storage_unavailable');
end;
$$;
revoke all on function public.device_notifications_operation(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.device_notifications_operation(text,uuid,jsonb) to service_role;
commit;
