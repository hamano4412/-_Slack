-- 002_supabase_auth.sql
-- name-only login を撤廃し、Supabase Auth (auth.users) に紐づくメール/パスワード認証へ移行する。
-- public.users.id は auth.users(id) を参照する。
-- 新規 signup 時に auth.users が INSERT されたら、トリガーで public.users 行も自動生成する。

-- 既存テーブルを依存順に drop(MVP のためデータは破棄)
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
drop table if exists public.messages cascade;
drop table if exists public.channels cascade;
drop table if exists public.users    cascade;

create table public.users (
  id         uuid        primary key references auth.users(id) on delete cascade,
  name       text        not null,
  email      text        not null unique,
  avatar     text        not null default '🙂',
  created_at timestamptz not null default now()
);

-- auth.users への INSERT で public.users 行を自動作成する。
-- signup 時に options.data で渡した name / avatar を user_metadata から取り出す。
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, name, email, avatar)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar', '🙂')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- channels / messages を再作成(shape は変更なし)
create table public.channels (
  id         text        primary key,
  name       text        not null,
  kind       text        not null check (kind in ('public', 'private', 'dm')),
  members    uuid[],
  created_at timestamptz not null default now()
);
create unique index channels_public_name_uidx
  on public.channels (name) where kind = 'public';

create table public.messages (
  id         uuid        primary key default gen_random_uuid(),
  channel_id text        not null references public.channels(id) on delete cascade,
  user_id    uuid        not null references public.users(id)    on delete cascade,
  user_name  text        not null,
  body       text        not null,
  parent_id  uuid        references public.messages(id)         on delete cascade,
  reactions  jsonb       not null default '{}'::jsonb,
  mentions   uuid[]      not null default '{}',
  edited_at  timestamptz,
  created_at timestamptz not null default now()
);
create index messages_channel_idx on public.messages (channel_id, created_at);
create index messages_parent_idx  on public.messages (parent_id);

insert into public.channels (id, name, kind) values
  ('general', 'general', 'public'),
  ('random',  'random',  'public')
on conflict (id) do nothing;
