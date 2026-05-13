-- 004_admin_role.sql
-- 管理者権限を導入する。
-- - public.users に is_admin 列を追加(default false)
-- - 「よ」という名前で signup したユーザーは自動的に管理者扱い(bootstrap)
-- - 既存の「よ」がいれば管理者に昇格

alter table public.users
  add column if not exists is_admin boolean not null default false;

-- auth.users → public.users の自動作成トリガーを再定義(is_admin を反映する版)
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_name text;
begin
  derived_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  insert into public.users (id, name, email, avatar, is_admin)
  values (
    new.id,
    derived_name,
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar', '🙂'),
    derived_name = 'よ'
  );
  return new;
end;
$$;

-- 既存ユーザーで名前が 「よ」 なら管理者に昇格
update public.users set is_admin = true where name = 'よ';
