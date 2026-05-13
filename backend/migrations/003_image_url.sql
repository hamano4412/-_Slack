-- 003_image_url.sql
-- メッセージに添付された画像の公開 URL を保存する列を追加する。
-- 1 メッセージ 1 画像。複数添付が必要になったら別表に正規化する。

alter table public.messages
  add column if not exists image_url text;
