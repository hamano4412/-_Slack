-- 001_initial.sql
-- Slack-like MVP schema. Tables under the public schema.
-- Run via Supabase Management API: POST /v1/projects/{ref}/database/query

-- Idempotent: drop in dependency order, then recreate.
drop table if exists public.messages cascade;
drop table if exists public.channels cascade;
drop table if exists public.users    cascade;

create table public.users (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  avatar     text        not null default '🙂',
  created_at timestamptz not null default now()
);
-- 同名は実装上は OK にしている(再ログインで既存ユーザーを引く)が、念のため
-- index でルックアップを速くしておく
create index users_name_idx on public.users (name);

create table public.channels (
  id         text        primary key,
  name       text        not null,
  kind       text        not null check (kind in ('public', 'private', 'dm')),
  members    uuid[],
  created_at timestamptz not null default now()
);
-- public は同名禁止(アプリ側でもチェックしているが DB でも担保)
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

-- 種チャンネル
insert into public.channels (id, name, kind) values
  ('general', 'general', 'public'),
  ('random',  'random',  'public')
on conflict (id) do nothing;
