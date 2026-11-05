-- Звіт про прийом їжі для клієнтів на супроводі.
-- Клієнт на супроводі не може просто натиснути «зʼїдено»: спершу він надсилає в щоденник
-- фото страви або коментар (якщо сфотографувати не вийшло). База перевіряє це сама,
-- тож обійти вимогу запитом в обхід інтерфейсу не вийде.

-- 1. Чи на супроводі клієнт. За замовчуванням — так: усі нинішні активні клієнти саме на ньому.
alter table clients
  add column on_support boolean not null default true;

-- 2. Запис щоденника знає, до якої страви меню він належить.
alter table diary_entries
  add column menu_meal_id uuid references menu_meals (id) on delete set null;
create index diary_entries_menu_meal_idx on diary_entries (menu_meal_id) where menu_meal_id is not null;

-- 3. Чи можна відмітити страву «зʼїдено»: клієнт не на супроводі — завжди;
--    на супроводі — лише коли до неї є запис із фото або з власним коментарем
--    (назва страви, яку підставляє форма, коментарем не вважається).
--    Фото — лише з папки самого клієнта, як його кладе кабінет.
create function meal_report_ok(p_meal uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select not coalesce((select on_support from clients where id = my_client_id()), false)
      or exists (
        select 1
          from diary_entries d
          join menu_meals mm on mm.id = d.menu_meal_id
         where d.menu_meal_id = p_meal
           and d.client_id = my_client_id()
           and (d.photo_path like d.client_id::text || '/%'
                or (coalesce(btrim(d.note), '') <> '' and btrim(d.note) <> btrim(mm.title)))
      )
$$;

-- 4. meal_checks: нутриціолог — як і раніше все; клієнт бачить і знімає свої відмітки,
--    а ставить — лише за умовою вище.
drop policy meal_checks_rw on meal_checks;

create policy meal_checks_nutri on meal_checks for all to authenticated
  using (is_nutri()) with check (is_nutri());
create policy meal_checks_client_select on meal_checks for select to authenticated
  using (client_id = my_client_id());
create policy meal_checks_client_delete on meal_checks for delete to authenticated
  using (client_id = my_client_id());
create policy meal_checks_client_insert on meal_checks for insert to authenticated
  with check (client_id = my_client_id() and meal_report_ok(meal_id));
create policy meal_checks_client_update on meal_checks for update to authenticated
  using (client_id = my_client_id())
  with check (client_id = my_client_id() and meal_report_ok(meal_id));
