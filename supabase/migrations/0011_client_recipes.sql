-- Клієнт бачить лише ті рецепти, які вже отримував у своїх меню, а не всю базу Анастасії.
-- «Отримував» = страва з цим рецептом є в його опублікованому меню (menu_meals пишеться лише
-- під час «Зберегти й надіслати»; чернетки клієнту не видно). Нутриціолог бачить усе, як і раніше.
-- Обмеження в RLS, а не лише в інтерфейсі: інакше решту рецептів можна було б прочитати через API.

create index if not exists menu_meals_recipe_idx on menu_meals (recipe_id) where recipe_id is not null;

-- security definer: перевіряє меню клієнта одним запитом за індексом, без ланцюжка політик
create or replace function client_has_recipe(p_recipe uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from menu_meals mm
      join menus m on m.id = mm.menu_id
     where mm.recipe_id = p_recipe
       and m.client_id = my_client_id()
       and m.published
  )
$$;
revoke execute on function client_has_recipe(uuid) from public, anon;
grant execute on function client_has_recipe(uuid) to authenticated;

-- рецепти
drop policy if exists recipes_select on recipes;
create policy recipes_select on recipes for select to authenticated
  using (is_nutri() or client_has_recipe(id));

-- склад рецепта — лише для видимих рецептів
drop policy if exists recipe_ingredients_select on recipe_ingredients;
create policy recipe_ingredients_select on recipe_ingredients for select to authenticated
  using (is_nutri() or client_has_recipe(recipe_id));

-- фото страв: файл лежить у папці <id рецепта>/…
drop policy if exists storage_recipes_read on storage.objects;
create policy storage_recipes_read on storage.objects for select to authenticated
  using (
    bucket_id = 'recipes'
    and (
      is_nutri()
      -- case: не перетворювати в uuid чужі шляхи (інакше помилка замість «немає доступу»)
      or case
           when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then client_has_recipe(((storage.foldername(name))[1])::uuid)
           else false
         end
    )
  );
