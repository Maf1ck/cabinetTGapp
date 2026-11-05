// База рецептів. Читають усі, хто увійшов; пише лише нутриціолог (RLS: is_nutri()).
import { supabase } from '@/lib/supabase'
import { formatAmount, normalize } from '@/lib/recipes'
import { must } from './client'

export interface RecipeSummary {
  id: string
  title: string
  category: string | null
  aliases: string[]
  /** назви інгредієнтів — щоб шукати «що приготувати з куркою» */
  ingredients: string[]
}

export interface RecipeLine {
  id: string
  ingredient_id: string | null
  name: string
  amount: string | null
  qty_from: number | null
  qty_to: number | null
  unit: string | null
  note: string | null
  position: number
}

export interface Recipe {
  id: string
  title: string
  category: string | null
  servings: string | null
  instructions: string | null
  notes: string | null
  source: string | null
  aliases: string[]
  lines: RecipeLine[]
  photo_path: string | null
  /** підпис для фото зі стороннього джерела: «автор · ліцензія»; власні фото — null */
  photo_credit: string | null
  /** сторінка оригіналу (для ліцензії) */
  photo_source: string | null
  /** підписане посилання на фото (живе годину) */
  photoUrl: string | null
}

export interface Ingredient {
  id: string
  name: string
  category: string | null
  default_unit: string | null
  aliases: string[]
}

export interface RecipeLineDraft {
  name: string
  qty_from: number | null
  qty_to: number | null
  unit: string | null
  note: string | null
}

export interface RecipeDraft {
  title: string
  category: string | null
  servings: string | null
  instructions: string | null
  notes: string | null
  lines: RecipeLineDraft[]
}

const LINE_FIELDS = 'id, ingredient_id, name, amount, qty_from, qty_to, unit, note, position'
const RECIPE_FIELDS = `id, title, category, servings, instructions, notes, source, aliases, photo_path, photo_credit, photo_source, lines:recipe_ingredients(${LINE_FIELDS})`

type SummaryRow = Omit<RecipeSummary, 'ingredients'> & { recipe_ingredients: { name: string }[] }

export async function listRecipes(): Promise<RecipeSummary[]> {
  const rows = must(
    await supabase().from('recipes').select('id, title, category, aliases, recipe_ingredients(name)').order('title'),
  ) as SummaryRow[]
  return rows.map(({ recipe_ingredients, ...r }) => ({ ...r, ingredients: recipe_ingredients.map((i) => i.name) }))
}

const sortLines = (r: Recipe): Recipe => ({ ...r, lines: [...r.lines].sort((a, b) => a.position - b.position) })

/** Фото страв лежать у приватному бакеті `recipes`: віддаємо підписані посилання (на годину). */
export async function recipePhotoUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))]
  const urls = new Map<string, string>()
  if (!unique.length) return urls
  const { data } = await supabase().storage.from('recipes').createSignedUrls(unique, 3600)
  for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  return urls
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const row = must(await supabase().from('recipes').select(RECIPE_FIELDS).eq('id', id).maybeSingle()) as Omit<
    Recipe,
    'photoUrl'
  > | null
  if (!row) return null
  const urls = await recipePhotoUrls([row.photo_path])
  return sortLines({ ...row, photoUrl: row.photo_path ? (urls.get(row.photo_path) ?? null) : null })
}

/** Ставить (або замінює) фото страви. Старий файл прибираємо лише після того, як новий записано. */
export async function setRecipePhoto(recipe: Pick<Recipe, 'id' | 'photo_path'>, photo: Blob): Promise<Recipe> {
  const ext = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${recipe.id}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase().storage.from('recipes').upload(path, photo, { contentType: photo.type || 'image/jpeg' })
  if (error) throw error
  // власне фото — підпис стороннього автора більше не потрібен
  const { error: dbError } = await supabase()
    .from('recipes')
    .update({ photo_path: path, photo_credit: null, photo_source: null })
    .eq('id', recipe.id)
  if (dbError) {
    await supabase().storage.from('recipes').remove([path])
    throw dbError
  }
  if (recipe.photo_path) await supabase().storage.from('recipes').remove([recipe.photo_path])
  return (await getRecipe(recipe.id))!
}

export async function removeRecipePhoto(recipe: Pick<Recipe, 'id' | 'photo_path'>): Promise<void> {
  must(await supabase().from('recipes').update({ photo_path: null, photo_credit: null, photo_source: null }).eq('id', recipe.id))
  if (recipe.photo_path) await supabase().storage.from('recipes').remove([recipe.photo_path])
}

export async function listIngredients(): Promise<Ingredient[]> {
  return must(
    await supabase().from('ingredients').select('id, name, category, default_unit, aliases').order('name'),
  )
}

/** Шукає інгредієнт у довіднику за назвою чи синонімом; якого нема — додає. */
async function resolveIngredients(names: string[], catalog: Ingredient[], units: Map<string, string | null>) {
  const byName = new Map<string, Ingredient>()
  for (const i of catalog) for (const n of [i.name, ...i.aliases]) byName.set(normalize(n), i)

  const missing = [...new Set(names.filter((n) => !byName.has(normalize(n))))]
  if (missing.length) {
    const created = must(
      await supabase()
        .from('ingredients')
        .insert(missing.map((name) => ({ name, default_unit: units.get(name) ?? null })))
        .select('id, name, category, default_unit, aliases'),
    ) as Ingredient[]
    for (const i of created) byName.set(normalize(i.name), i)
  }
  return (name: string) => byName.get(normalize(name))!
}

/**
 * Зберігає рецепт разом зі складом. Склад замінюється «спершу нові, потім прибрати старі»:
 * якщо щось зірветься посередині, рецепт не лишиться без інгредієнтів.
 */
export async function saveRecipe(draft: RecipeDraft, catalog: Ingredient[], existing?: Recipe): Promise<Recipe> {
  const { lines, ...fields } = draft
  const table = supabase().from('recipes')
  const saved = must(
    existing
      ? await table.update(fields).eq('id', existing.id).select('id').single()
      : await table.insert(fields).select('id').single(),
  ) as { id: string }

  const filled = lines.filter((l) => l.name.trim())
  const find = await resolveIngredients(
    filled.map((l) => l.name.trim()),
    catalog,
    new Map(filled.map((l) => [l.name.trim(), l.unit])),
  )
  if (filled.length) {
    must(
      await supabase()
        .from('recipe_ingredients')
        .insert(
          filled.map((l, i) => {
            const ingredient = find(l.name.trim())
            return {
              recipe_id: saved.id,
              ingredient_id: ingredient.id,
              name: ingredient.name,
              amount: formatAmount(l.qty_from, l.qty_to, l.unit),
              qty_from: l.qty_from,
              qty_to: l.qty_to,
              unit: l.qty_from === null ? null : l.unit,
              note: l.note,
              position: i + 1,
            }
          }),
        ),
    )
  }
  const oldIds = existing?.lines.map((l) => l.id) ?? []
  if (oldIds.length) must(await supabase().from('recipe_ingredients').delete().in('id', oldIds))

  return (await getRecipe(saved.id))!
}

/** Страви в меню, що посилались на рецепт, лишаються — лише без посилання (on delete set null). */
export async function deleteRecipe(recipe: Pick<Recipe, 'id' | 'photo_path'>): Promise<void> {
  must(await supabase().from('recipes').delete().eq('id', recipe.id))
  if (recipe.photo_path) await supabase().storage.from('recipes').remove([recipe.photo_path])
}
