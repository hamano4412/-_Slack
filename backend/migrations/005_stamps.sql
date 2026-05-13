-- 005_stamps.sql
-- 個人スタンプ(文字 + 色 + フォント + 名前)。
-- 作成・編集は自分のみ。メッセージ送信時にスナップショットを `messages.stamp` に保存し、
-- スタンプ定義を削除しても過去メッセージは壊れないようにする。

create table public.stamps (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  name       text        not null,
  text       text        not null,
  color      text        not null default '#111111',
  font       text        not null default 'sans',
  created_at timestamptz not null default now()
);
create index stamps_user_idx on public.stamps (user_id, created_at desc);

alter table public.messages
  add column if not exists stamp jsonb;
