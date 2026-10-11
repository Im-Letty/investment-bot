-- Retire browser writes to the legacy conversation archive. Historical rows,
-- existing SELECT grants, and service_role permissions remain unchanged.
-- The application serves this archive read-only; stock_comments is untouched.
begin;
revoke insert, update, delete, truncate, references, trigger
  on public.messages from public, anon, authenticated;
-- Explicit column grants, if present, survive a table-level REVOKE.
do $$
declare col text;
begin
  for col in select attname from pg_attribute
    where attrelid='public.messages'::regclass and attnum>0 and not attisdropped
  loop
    execute format('revoke insert (%I), update (%I), references (%I) on public.messages from public, anon, authenticated', col, col, col);
  end loop;
end;
$$;
notify pgrst, 'reload schema';
commit;

-- Metadata only: verify the retired write path and preserved server reading.
select
  not has_table_privilege('anon', 'public.messages', 'INSERT,UPDATE,DELETE,TRUNCATE')
    as anonymous_archive_writes_disabled,
  not has_table_privilege('authenticated', 'public.messages', 'INSERT,UPDATE,DELETE,TRUNCATE')
    as authenticated_archive_writes_disabled,
  not has_any_column_privilege('anon', 'public.messages', 'INSERT,UPDATE')
    and not has_any_column_privilege('authenticated', 'public.messages', 'INSERT,UPDATE')
    as browser_column_writes_disabled,
  has_table_privilege('service_role', 'public.messages', 'SELECT')
    as server_archive_read_preserved;
