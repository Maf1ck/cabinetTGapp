-- Продукти з грамовкою в прийомі їжі: «Гречка 60 г», «Олія оливкова 5 мл», «Яблуко 150 г».
-- Окремо від рецепта: страва може бути лише рецептом, лише продуктами або і тим, і тим.
-- jsonb, бо чернетка меню теж jsonb і продукти завжди читаються разом зі стравою.
-- Елемент: { ingredient_id: uuid|null, name: text, qty: number|null, unit: text|null, category: text|null }
alter table menu_meals
  add column products jsonb not null default '[]'
    check (jsonb_typeof(products) = 'array' and jsonb_array_length(products) <= 30);

-- publish_menu з 0009 + продукти
create or replace function publish_menu(p_menu_id uuid) returns void
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

    -- рецепт могли видалити, поки лежала чернетка: тоді страва лишається без посилання;
    -- чернетки, збережені до цієї міграції, продуктів не мають
    insert into menu_meals (id, menu_id, day, meal, at_time, title, recipe_id, products)
    select d.id, p_menu_id, d.day, d.meal, d.at_time, d.title, r.id, coalesce(d.products, '[]')
      from jsonb_to_recordset(draft)
           as d (id uuid, day smallint, meal meal_type, at_time time, title text, recipe_id uuid, products jsonb)
      left join recipes r on r.id = d.recipe_id
    on conflict (id) do update
      set day = excluded.day,
          meal = excluded.meal,
          at_time = excluded.at_time,
          title = excluded.title,
          recipe_id = excluded.recipe_id,
          products = excluded.products
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
