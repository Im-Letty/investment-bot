-- Passkey-only identity provider. All private state is accessible only to service_role.
-- Does not change existing users, credentials, auth providers, or application tables.
begin;
create table if not exists public.passkey_auth_config (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  provider_ready boolean not null default false,
  provision_requested boolean not null default false,
  provisioning_until timestamptz,
  provisioning_token text,
  provider_id text,
  client_secret_hash text,
  provisioning_error text,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.passkey_auth_config(id) values(true) on conflict do nothing;
create table if not exists public.passkey_auth_accounts (
  account_id uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);
create table if not exists public.passkey_auth_credentials (
  credential_id text primary key,
  account_id uuid not null references public.passkey_auth_accounts(account_id),
  public_key text not null,
  sign_count bigint not null check(sign_count >= 0),
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  last_used_at timestamptz
);
create index if not exists passkey_auth_credentials_account on public.passkey_auth_credentials(account_id);
create table if not exists public.passkey_auth_flows (
  flow_hash text primary key,
  csrf_hash text not null,
  mode text not null check(mode in ('signup','login')),
  account_id uuid not null,
  client_id text not null,
  redirect_uri text not null,
  state text not null,
  code_challenge text not null,
  expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
  challenge text,
  challenge_version text,
  challenge_kind text,
  challenge_expires_at timestamptz,
  challenge_claimed boolean not null default false,
  completed boolean not null default false,
  code_hash text unique,
  code_expires_at timestamptz,
  code_consumed boolean not null default false
);
create index if not exists passkey_auth_flows_expiry on public.passkey_auth_flows(expires_at);
create table if not exists public.passkey_auth_access_tokens (
  access_token_hash text primary key,
  account_id uuid not null references public.passkey_auth_accounts(account_id),
  expires_at timestamptz not null default clock_timestamp()+interval '5 minutes'
);
create table if not exists public.passkey_auth_rate_limits (
  key text primary key,
  count integer not null,
  expires_at timestamptz not null
);
create index if not exists passkey_auth_access_tokens_expiry on public.passkey_auth_access_tokens(expires_at);
create index if not exists passkey_auth_rate_limits_expiry on public.passkey_auth_rate_limits(expires_at);
alter table public.passkey_auth_config enable row level security;
alter table public.passkey_auth_accounts enable row level security;
alter table public.passkey_auth_credentials enable row level security;
alter table public.passkey_auth_flows enable row level security;
alter table public.passkey_auth_access_tokens enable row level security;
alter table public.passkey_auth_rate_limits enable row level security;
revoke all on public.passkey_auth_config, public.passkey_auth_accounts, public.passkey_auth_credentials, public.passkey_auth_flows, public.passkey_auth_access_tokens, public.passkey_auth_rate_limits from public, anon, authenticated;
grant all on public.passkey_auth_config, public.passkey_auth_accounts, public.passkey_auth_credentials, public.passkey_auth_flows, public.passkey_auth_access_tokens, public.passkey_auth_rate_limits to service_role;

create or replace function public.passkey_auth_operation(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.passkey_auth_flows%rowtype;
  c public.passkey_auth_credentials%rowtype;
  cfg public.passkey_auth_config%rowtype;
  n integer;
  uid uuid;
  v_limit integer;
  v_window integer;
begin
  if p_action='config' then
    select * into cfg from public.passkey_auth_config where id=true;
    return jsonb_build_object('enabled',cfg.enabled and cfg.provider_ready,'client_secret_hash',cfg.client_secret_hash);
  elsif p_action='claim_provision' then
    if coalesce(length(p_data->>'lease_token'),0)<20 then return 'false'::jsonb; end if;
    update public.passkey_auth_config set provisioning_until=clock_timestamp()+interval '5 minutes',provisioning_token=p_data->>'lease_token',updated_at=clock_timestamp()
      where id=true and provision_requested and not provider_ready and (provisioning_until is null or provisioning_until<clock_timestamp()) returning * into cfg;
    return to_jsonb(found);
  elsif p_action='finish_provision' then
    if coalesce(p_data->>'client_secret_hash','')!~'^[0-9a-f]{64}$' or coalesce(length(p_data->>'provider_id'),0)=0 then return 'false'::jsonb; end if;
    update public.passkey_auth_config set client_secret_hash=p_data->>'client_secret_hash',provider_id=p_data->>'provider_id',provider_ready=true,enabled=true,provision_requested=false,provisioning_until=null,provisioning_token=null,provisioning_error=null,updated_at=clock_timestamp()
      where id=true and not provider_ready and provisioning_token=p_data->>'lease_token' and provisioning_until>clock_timestamp();
    return to_jsonb(found);
  elsif p_action='fail_provision' then
    update public.passkey_auth_config set provision_requested=false,provisioning_until=null,provisioning_token=null,provisioning_error='provider_setup_failed',updated_at=clock_timestamp()
      where id=true and not provider_ready and provisioning_token=p_data->>'lease_token' and provisioning_until>clock_timestamp();
    return to_jsonb(found);
  elsif p_action='rate_limit' then
    v_limit:=greatest(1,least(1000,(p_data->>'limit')::integer));
    v_window:=greatest(1,least(3600,(p_data->>'window_seconds')::integer));
    -- Expiring operational state only; credentials and accounts are never pruned here.
    delete from public.passkey_auth_rate_limits where expires_at<clock_timestamp()-interval '1 hour';
    delete from public.passkey_auth_flows where expires_at<clock_timestamp()-interval '1 hour';
    delete from public.passkey_auth_access_tokens where expires_at<clock_timestamp();
    insert into public.passkey_auth_rate_limits(key,count,expires_at) values(p_data->>'key',1,clock_timestamp()+make_interval(secs=>v_window))
      on conflict(key) do update set count=case when passkey_auth_rate_limits.expires_at<=clock_timestamp() then 1 else least(passkey_auth_rate_limits.count+1,1001) end,
        expires_at=case when passkey_auth_rate_limits.expires_at<=clock_timestamp() then clock_timestamp()+make_interval(secs=>v_window) else passkey_auth_rate_limits.expires_at end
      returning count into n;
    return to_jsonb(n<=v_limit);
  elsif p_action='create_flow' then
    insert into public.passkey_auth_flows(flow_hash,csrf_hash,mode,account_id,client_id,redirect_uri,state,code_challenge)
      values(p_data->>'flow_hash',p_data->>'csrf_hash',p_data->>'mode',(p_data->>'account_id')::uuid,p_data->>'client_id',p_data->>'redirect_uri',p_data->>'state',p_data->>'code_challenge');
    return 'true'::jsonb;
  elsif p_action='get_flow' then
    select * into f from public.passkey_auth_flows where flow_hash=p_data->>'flow_hash' and expires_at>clock_timestamp() and not completed;
    if not found then return null; end if;
    return to_jsonb(f);
  elsif p_action='set_challenge' then
    update public.passkey_auth_flows set challenge=p_data->>'challenge',challenge_version=p_data->>'challenge_version',challenge_kind=p_data->>'kind',challenge_claimed=false,challenge_expires_at=least(expires_at,clock_timestamp()+interval '5 minutes')
      where flow_hash=p_data->>'flow_hash' and csrf_hash=p_data->>'csrf_hash' and expires_at>clock_timestamp() and not completed
      and ((mode='signup' and p_data->>'kind'='registration') or (mode='login' and p_data->>'kind'='authentication'));
    return to_jsonb(found);
  elsif p_action='claim_challenge' then
    update public.passkey_auth_flows set challenge_claimed=true
      where flow_hash=p_data->>'flow_hash' and csrf_hash=p_data->>'csrf_hash' and challenge_kind=p_data->>'kind'
      and expires_at>clock_timestamp() and challenge_expires_at>clock_timestamp() and not challenge_claimed and not completed returning * into f;
    if not found then return null; end if;
    return to_jsonb(f);
  elsif p_action='get_credential' then
    select * into c from public.passkey_auth_credentials where credential_id=p_data->>'credential_id';
    if not found then return null; end if;
    return to_jsonb(c);
  elsif p_action='finish_registration' then
    if p_data->>'sign_count' is null or p_data->>'credential_id' is null or p_data->>'public_key' is null or p_data->>'code_hash' is null then return 'false'::jsonb; end if;
    select * into f from public.passkey_auth_flows where flow_hash=p_data->>'flow_hash' for update;
    if not found or f.mode is distinct from 'signup' or f.completed or not f.challenge_claimed or f.challenge_kind is distinct from 'registration' or f.challenge_version is distinct from p_data->>'challenge_version' or f.expires_at<=clock_timestamp() or f.challenge_expires_at<=clock_timestamp() then return 'false'::jsonb; end if;
    insert into public.passkey_auth_accounts(account_id) values(f.account_id);
    insert into public.passkey_auth_credentials(credential_id,account_id,public_key,sign_count)
      values(p_data->>'credential_id',f.account_id,p_data->>'public_key',(p_data->>'sign_count')::bigint);
    update public.passkey_auth_flows set completed=true,code_hash=p_data->>'code_hash',code_expires_at=clock_timestamp()+interval '60 seconds' where flow_hash=f.flow_hash;
    return 'true'::jsonb;
  elsif p_action='finish_authentication' then
    if p_data->>'sign_count' is null or p_data->>'code_hash' is null then return 'false'::jsonb; end if;
    select * into f from public.passkey_auth_flows where flow_hash=p_data->>'flow_hash' for update;
    if not found or f.mode is distinct from 'login' or f.completed or not f.challenge_claimed or f.challenge_kind is distinct from 'authentication' or f.challenge_version is distinct from p_data->>'challenge_version' or f.expires_at<=clock_timestamp() or f.challenge_expires_at<=clock_timestamp() then return 'false'::jsonb; end if;
    select * into c from public.passkey_auth_credentials where credential_id=p_data->>'credential_id' for update;
    if not found or c.version is distinct from (p_data->>'credential_version')::bigint or c.sign_count is distinct from (p_data->>'previous_sign_count')::bigint then return 'false'::jsonb; end if;
    if not (c.sign_count=0 and (p_data->>'sign_count')::bigint=0) and (p_data->>'sign_count')::bigint<=c.sign_count then return 'false'::jsonb; end if;
    update public.passkey_auth_credentials set sign_count=(p_data->>'sign_count')::bigint,version=version+1,last_used_at=clock_timestamp() where credential_id=c.credential_id;
    update public.passkey_auth_flows set account_id=c.account_id,completed=true,code_hash=p_data->>'code_hash',code_expires_at=clock_timestamp()+interval '60 seconds' where flow_hash=f.flow_hash;
    return 'true'::jsonb;
  elsif p_action='exchange_code' then
    if p_data->>'access_token_hash' is null then return null; end if;
    select * into f from public.passkey_auth_flows where code_hash=p_data->>'code_hash' for update;
    if not found or not f.completed or f.code_consumed or f.code_expires_at<=clock_timestamp() or f.client_id is distinct from p_data->>'client_id' or f.redirect_uri is distinct from p_data->>'redirect_uri' or f.code_challenge is distinct from p_data->>'code_challenge' then return null; end if;
    update public.passkey_auth_flows set code_consumed=true where flow_hash=f.flow_hash;
    insert into public.passkey_auth_access_tokens(access_token_hash,account_id) values(p_data->>'access_token_hash',f.account_id);
    return jsonb_build_object('account_id',f.account_id);
  elsif p_action='userinfo' then
    select account_id into uid from public.passkey_auth_access_tokens where access_token_hash=p_data->>'access_token_hash' and expires_at>clock_timestamp();
    if not found then return null; end if;
    return jsonb_build_object('account_id',uid);
  end if;
  raise exception 'Unsupported passkey operation';
exception when unique_violation then return 'false'::jsonb;
end;
$$;
revoke all on function public.passkey_auth_operation(text,jsonb) from public,anon,authenticated;
grant execute on function public.passkey_auth_operation(text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
