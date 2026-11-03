-- Сесії тепер видає Supabase Auth (проєкт підписує JWT ключем ES256, власні HS256-токени він не приймає).
-- Сервер створює для кожного користувача Telegram «тихий» акаунт auth.users (технічна пошта,
-- без пароля) і бере для нього сесію. users.id = auth.users.id, тож auth.uid() у RLS не змінюється.

-- Рядки з попередньої схеми без акаунта Auth: лише тестові, до запуску
delete from users where id not in (select id from auth.users);

alter table users alter column id drop default;
alter table users
  add constraint users_id_auth_fkey foreign key (id) references auth.users (id) on delete cascade;

-- Вимкнений клієнт (active = false) одразу втрачає доступ до своїх даних, навіть із живою сесією
create or replace function my_client_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from clients where user_id = auth.uid() and active
$$;
