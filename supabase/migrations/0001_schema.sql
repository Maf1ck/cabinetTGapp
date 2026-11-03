-- Кабінет нутриціолога: схема, RLS і сховище.
--
-- Модель доступу:
--   * Користувачі живуть у public.users (Telegram ID), а не в auth.users.
--   * Після входу через Telegram сервер (api/) видає JWT, підписаний секретом
--     Supabase: sub = users.id, role = 'authenticated'. Тому auth.uid() у RLS
--     повертає наш users.id.
--   * Роль нутриціолога (Анастасія) визначається полем users.role. Клієнт бачить
--     лише рядки зі своїм client_id.
--   * Таблиці без політик (login_tokens, invites, notifications) доступні лише
--     серверу через service_role, який RLS обходить.

-- ---------------------------------------------------------------- типи
create type user_role      as enum ('nutri', 'client');
create type meal_type      as enum ('breakfast', 'snack1', 'lunch', 'snack2', 'dinner');
create type appt_status    as enum ('planned', 'done', 'cancelled');
create type payment_status as enum ('pending', 'paid', 'cancelled');

-- ---------------------------------------------------------------- користувачі
create table users (
  id          uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  role        user_role not null default 'client',
  first_name  text,
  username    text,
  created_at  timestamptz not null default now()
);

-- Картка клієнта. user_id порожній, поки клієнт не прийняв запрошення.
create table clients (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references users (id) on delete set null,
  full_name     text not null,
  goal          text,
  program_title text,
  program_week  smallint check (program_week >= 0),
  program_weeks smallint check (program_weeks >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- хелпери RLS
-- security definer: читають users/clients в обхід RLS, інакше політики зациклилися б.
create function is_nutri() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from users where id = auth.uid() and role = 'nutri')
$$;

create function my_client_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from clients where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------- службові (лише сервер)
-- Одноразові токени входу з браузера: сайт → бот → підтвердження.
create table login_tokens (
  token       text primary key,
  telegram_id bigint,                       -- заповнює бот після підтвердження
  expires_at  timestamptz not null,
  consumed_at timestamptz
);

-- Запрошення: Анастасія створює клієнта, клієнт відкриває t.me/bot?start=inv_<code>.
create table invites (
  code       text primary key,
  client_id  uuid not null references clients (id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- Черга сповіщень у Telegram; її розбирає крон.
create table notifications (
  id          bigint generated always as identity primary key,
  telegram_id bigint not null,
  kind        text not null,
  payload     jsonb not null default '{}',
  send_at     timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    smallint not null default 0
);
create index notifications_due_idx on notifications (send_at) where sent_at is null;

-- ---------------------------------------------------------------- зустрічі
create table appointments (
  id        uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients (id) on delete cascade,
  starts_at timestamptz not null,
  kind      text not null default 'Супровід',
  status    appt_status not null default 'planned',
  zoom_url  text,
  note      text
);
create index appointments_client_idx on appointments (client_id, starts_at);

-- ---------------------------------------------------------------- рецепти
create table recipes (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  instructions text,
  photo_path   text,
  kcal         integer check (kcal >= 0),
  created_at   timestamptz not null default now()
);

create table recipe_ingredients (
  id        uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes (id) on delete cascade,
  name      text not null,
  amount    text
);
create index recipe_ingredients_recipe_idx on recipe_ingredients (recipe_id);

-- ---------------------------------------------------------------- меню
create table menus (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients (id) on delete cascade,
  week_start date not null,
  published  boolean not null default false,
  unique (client_id, week_start)
);

create table menu_meals (
  id        uuid primary key default gen_random_uuid(),
  menu_id   uuid not null references menus (id) on delete cascade,
  day       smallint not null check (day between 1 and 7),
  meal      meal_type not null,
  at_time   time,
  title     text not null,
  recipe_id uuid references recipes (id) on delete set null
);
create index menu_meals_menu_idx on menu_meals (menu_id, day);

-- «З'їдено» — окрема таблиця: RLS не вміє обмежувати колонки, а клієнту
-- можна змінювати лише відмітку, не саму страву.
create table meal_checks (
  meal_id   uuid primary key references menu_meals (id) on delete cascade,
  client_id uuid not null references clients (id) on delete cascade,
  eaten_at  timestamptz not null default now()
);

create table shopping_items (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients (id) on delete cascade,
  week_start date not null,
  name       text not null,
  amount     text,
  checked    boolean not null default false
);
create index shopping_items_client_idx on shopping_items (client_id, week_start);

-- ---------------------------------------------------------------- щоденник
create table diary_entries (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients (id) on delete cascade,
  meal          meal_type,
  photo_path    text,
  note          text,
  taken_at      timestamptz not null default now(),
  seen_by_nutri boolean not null default false
);
create index diary_entries_client_idx on diary_entries (client_id, taken_at desc);
create index diary_entries_unseen_idx on diary_entries (taken_at desc) where not seen_by_nutri;

create table diary_comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references diary_entries (id) on delete cascade,
  author_id  uuid not null references users (id),
  body       text not null,
  created_at timestamptz not null default now()
);
create index diary_comments_entry_idx on diary_comments (entry_id);

-- Шаблони швидких відповідей Анастасії («Чудова тарілка!»)
create table comment_templates (
  id   uuid primary key default gen_random_uuid(),
  body text not null
);

-- ---------------------------------------------------------------- звички та самопочуття
create table habits (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references clients (id) on delete cascade,
  title          text not null,
  target_per_week smallint not null default 7 check (target_per_week between 1 and 7)
);

create table habit_logs (
  habit_id uuid not null references habits (id) on delete cascade,
  day      date not null,
  primary key (habit_id, day)
);

create table water_logs (
  client_id uuid not null references clients (id) on delete cascade,
  day       date not null,
  glasses   smallint not null default 0 check (glasses between 0 and 30),
  primary key (client_id, day)
);

create table wellbeing_logs (
  client_id uuid not null references clients (id) on delete cascade,
  day       date not null,
  energy    smallint check (energy    between 1 and 5),
  sleep     smallint check (sleep     between 1 and 5),
  digestion smallint check (digestion between 1 and 5),
  mood      smallint check (mood      between 1 and 5),
  primary key (client_id, day)
);

-- ---------------------------------------------------------------- аналізи та оплати
create table lab_files (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  title       text not null,
  file_path   text not null,
  uploaded_at timestamptz not null default now()
);
create index lab_files_client_idx on lab_files (client_id, uploaded_at desc);

create table payments (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients (id) on delete cascade,
  title      text not null,
  amount_uah integer not null check (amount_uah > 0),
  status     payment_status not null default 'pending',
  pay_url    text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);
create index payments_client_idx on payments (client_id, created_at desc);

-- ================================================================ RLS
alter table users              enable row level security;
alter table clients            enable row level security;
alter table login_tokens       enable row level security;
alter table invites            enable row level security;
alter table notifications      enable row level security;
alter table appointments       enable row level security;
alter table recipes            enable row level security;
alter table recipe_ingredients enable row level security;
alter table menus              enable row level security;
alter table menu_meals         enable row level security;
alter table meal_checks        enable row level security;
alter table shopping_items     enable row level security;
alter table diary_entries      enable row level security;
alter table diary_comments     enable row level security;
alter table comment_templates  enable row level security;
alter table habits             enable row level security;
alter table habit_logs         enable row level security;
alter table water_logs         enable row level security;
alter table wellbeing_logs     enable row level security;
alter table lab_files          enable row level security;
alter table payments           enable row level security;

-- users / clients ----------------------------------------------------------
create policy users_select on users for select to authenticated
  using (id = auth.uid() or is_nutri());

create policy clients_select on clients for select to authenticated
  using (user_id = auth.uid() or is_nutri());
create policy clients_nutri_write on clients for all to authenticated
  using (is_nutri()) with check (is_nutri());

-- Клієнт повністю керує своїми записами, нутриціолог бачить і правит усе ----
do $$
declare t text;
begin
  foreach t in array array[
    'meal_checks', 'shopping_items', 'water_logs', 'wellbeing_logs', 'lab_files'
  ] loop
    execute format(
      'create policy %I on %I for all to authenticated
         using (client_id = my_client_id() or is_nutri())
         with check (client_id = my_client_id() or is_nutri())',
      t || '_rw', t);
  end loop;
end $$;

-- Клієнт лише читає, пише нутриціолог ---------------------------------------
do $$
declare t text;
begin
  foreach t in array array['appointments', 'habits', 'payments'] loop
    execute format(
      'create policy %I on %I for select to authenticated
         using (client_id = my_client_id() or is_nutri())',
      t || '_select', t);
    execute format(
      'create policy %I on %I for all to authenticated
         using (is_nutri()) with check (is_nutri())',
      t || '_nutri_write', t);
  end loop;
end $$;

-- habit_logs: клієнт відмічає звички зі свого списку ------------------------
create policy habit_logs_rw on habit_logs for all to authenticated
  using (exists (select 1 from habits h
                 where h.id = habit_id and (h.client_id = my_client_id() or is_nutri())))
  with check (exists (select 1 from habits h
                      where h.id = habit_id and (h.client_id = my_client_id() or is_nutri())));

-- Рецепти: читають усі авторизовані, пише лише нутриціолог ------------------
create policy recipes_select on recipes for select to authenticated using (true);
create policy recipes_nutri_write on recipes for all to authenticated
  using (is_nutri()) with check (is_nutri());

create policy recipe_ingredients_select on recipe_ingredients for select to authenticated using (true);
create policy recipe_ingredients_nutri_write on recipe_ingredients for all to authenticated
  using (is_nutri()) with check (is_nutri());

-- Меню: клієнт бачить лише опубліковані --------------------------------------
create policy menus_select on menus for select to authenticated
  using ((client_id = my_client_id() and published) or is_nutri());
create policy menus_nutri_write on menus for all to authenticated
  using (is_nutri()) with check (is_nutri());

create policy menu_meals_select on menu_meals for select to authenticated
  using (exists (select 1 from menus m
                 where m.id = menu_id
                   and ((m.client_id = my_client_id() and m.published) or is_nutri())));
create policy menu_meals_nutri_write on menu_meals for all to authenticated
  using (is_nutri()) with check (is_nutri());

-- Щоденник: клієнт додає і видаляє своє, прапорець «переглянуто» ставить Анастасія
create policy diary_entries_select on diary_entries for select to authenticated
  using (client_id = my_client_id() or is_nutri());
create policy diary_entries_client_insert on diary_entries for insert to authenticated
  with check (client_id = my_client_id());
create policy diary_entries_client_delete on diary_entries for delete to authenticated
  using (client_id = my_client_id());
create policy diary_entries_nutri_write on diary_entries for all to authenticated
  using (is_nutri()) with check (is_nutri());

create policy diary_comments_select on diary_comments for select to authenticated
  using (exists (select 1 from diary_entries e
                 where e.id = entry_id and (e.client_id = my_client_id() or is_nutri())));
create policy diary_comments_nutri_write on diary_comments for all to authenticated
  using (is_nutri()) with check (is_nutri() and author_id = auth.uid());

create policy comment_templates_nutri on comment_templates for all to authenticated
  using (is_nutri()) with check (is_nutri());

-- login_tokens, invites, notifications: політик немає свідомо — лише service_role.

-- ================================================================ Storage
-- Шлях файлу: <client_id>/<ім'я>. Перший сегмент і є власником.
insert into storage.buckets (id, name, public) values
  ('diary',   'diary',   false),
  ('labs',    'labs',    false),
  ('recipes', 'recipes', false)
on conflict (id) do nothing;

create policy storage_client_files on storage.objects for all to authenticated
  using (
    bucket_id in ('diary', 'labs')
    and ((storage.foldername(name))[1] = my_client_id()::text or is_nutri())
  )
  with check (
    bucket_id in ('diary', 'labs')
    and ((storage.foldername(name))[1] = my_client_id()::text or is_nutri())
  );

create policy storage_recipes_read on storage.objects for select to authenticated
  using (bucket_id = 'recipes');
create policy storage_recipes_write on storage.objects for all to authenticated
  using (bucket_id = 'recipes' and is_nutri())
  with check (bucket_id = 'recipes' and is_nutri());
