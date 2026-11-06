-- Чернетка меню. Анастасія змінює меню скільки завгодно, закриває сторінку, повертається,
-- а клієнт бачить зміни й отримує сповіщення лише після «Зберегти».
-- Окрема таблиця, а не колонка в menus: RLS не обмежує колонки, і клієнт, який читає
-- свій рядок меню, прочитав би й чернетку.
create table menu_drafts (
  menu_id    uuid primary key references menus (id) on delete cascade,
  meals      jsonb not null check (jsonb_typeof(meals) = 'array'),
  updated_at timestamptz not null default now()
);

alter table menu_drafts enable row level security;
create policy menu_drafts_nutri on menu_drafts for all to authenticated
  using (is_nutri()) with check (is_nutri());

-- Номер збереженої версії: за ним сповіщення про кожне оновлення надсилається окремо.
-- Про вже опубліковані меню клієнт знає, тож вони починають з першої версії.
alter table menus add column revision integer not null default 0;
update menus set revision = 1 where published;

-- Застосовує чернетку до меню клієнта. Функція, бо це має відбутися цілком або ніяк:
-- клієнт не повинен застати меню, де старе вже видалено, а нове ще не додано.
-- Страви зі старими id оновлюються, тож відмітки «зʼїдено» на них лишаються.
create function publish_menu(p_menu_id uuid) returns void
  language plpgsql security invoker set search_path = public as $$
declare
  draft jsonb;
begin
  if not is_nutri() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select meals into draft from menu_drafts where menu_id = p_menu_id for update;

  if draft is not null then
    delete from menu_meals
     where menu_id = p_menu_id
       and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(draft) x);

    -- рецепт могли видалити, поки лежала чернетка: тоді страва лишається без посилання
    insert into menu_meals (id, menu_id, day, meal, at_time, title, recipe_id)
    select d.id, p_menu_id, d.day, d.meal, d.at_time, d.title, r.id
      from jsonb_to_recordset(draft)
           as d (id uuid, day smallint, meal meal_type, at_time time, title text, recipe_id uuid)
      left join recipes r on r.id = d.recipe_id
    on conflict (id) do update
      set day = excluded.day,
          meal = excluded.meal,
          at_time = excluded.at_time,
          title = excluded.title,
          recipe_id = excluded.recipe_id
      where menu_meals.menu_id = excluded.menu_id;

    delete from menu_drafts where menu_id = p_menu_id;
  end if;

  update menus
     set published = true,
         revision = case when draft is not null or revision = 0 then revision + 1 else revision end
   where id = p_menu_id;
end $$;

revoke execute on function publish_menu(uuid) from public;
grant execute on function publish_menu(uuid) to authenticated;
