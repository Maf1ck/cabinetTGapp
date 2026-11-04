-- База рецептів: каталог інгредієнтів і структурований склад страв.
-- Дані заливає `pnpm recipes:import <файл.xlsx>` (ідемпотентно, можна перезапускати).

-- Довідник інгредієнтів: категорія — для групування списку покупок
create table ingredients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  category     text,
  default_unit text,
  aliases      text[] not null default '{}'   -- як ще інгредієнт називається в документах
);

alter table recipes
  add column category text,                    -- Основна страва, Сніданок, Паста…
  add column servings text,                    -- як у джерелі: «2», «2–3», «2 перці»
  add column notes    text,                    -- подача, гарнір, варіанти
  add column source   text,                    -- з якого раціону взято
  add column aliases  text[] not null default '{}';

-- amount лишається готовим рядком для показу («40 г»), поруч — числа для підрахунків
alter table recipe_ingredients
  add column ingredient_id uuid references ingredients (id) on delete set null,
  add column qty_from      numeric check (qty_from >= 0),
  add column qty_to        numeric check (qty_to >= qty_from),
  add column unit          text,
  add column note          text,
  add column position      smallint not null default 0;
create index recipe_ingredients_ingredient_idx on recipe_ingredients (ingredient_id);

alter table ingredients enable row level security;
create policy ingredients_select on ingredients for select to authenticated using (true);
create policy ingredients_nutri_write on ingredients for all to authenticated
  using (is_nutri()) with check (is_nutri());
