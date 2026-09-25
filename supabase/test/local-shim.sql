-- Just enough of Supabase for schema.sql to run on a plain local Postgres
-- (roles, auth.jwt()/auth.uid(), the extensions schema). Never run this on Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'local' noinherit;
  end if;
end $$;
grant anon, authenticated to authenticator;

create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on all functions in schema auth to anon, authenticated;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated;
grant usage on schema public to anon, authenticated;
