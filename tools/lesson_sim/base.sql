create schema private;
create table public.members (id text primary key, name text not null, status text not null default '재원', memo text, kakao_user uuid);
create table public.teachers (id serial primary key, name text not null, active boolean default true, kakao_user uuid);
create table public.settings (id int primary key default 1);
insert into public.settings default values;
create table private.clock (id int primary key default 1, fixed_kst timestamp);
create function private.now_kst() returns timestamp language sql stable set search_path = '' as $$ select coalesce((select fixed_kst from private.clock where id = 1), now() at time zone 'Asia/Seoul'); $$;
create function private.my_teacher() returns public.teachers language sql stable set search_path = '' as $$
  select t from public.teachers t where t.id = nullif(current_setting('sim.tid', true), '')::int and t.active; $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('sim.admin', true), '') = '1'; $$;
