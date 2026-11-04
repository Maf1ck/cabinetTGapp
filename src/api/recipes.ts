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
const RECIPE_FIELDS = `id, title, category, servings, instructions, notes, source, aliases, lines:recipe_ingredients(${LINE_FIELDS})`

type SummaryRow = Omit<RecipeSummary, 'ingredients'> & { recipe_ingredients: { name: string }[] }

export async function listRecipes(): Promise<RecipeSummary[]> {
  const rows = must(
    await supabase().from('recipes').select('id, title, category, aliases, recipe_ingredients(name)').order('title'),
  ) as SummaryRow[]
  return rows.map(({ recipe_ingredients, ...r }) => ({ ...r, ingredients: recipe_ingredients.map((i) => i.name) }))
}

const sortLines = (r: Recipe): Recipe => ({ ...r, lines: [...r.lines].sort((a, b) => a.position - b.position) })

export async function getRecipe(id: string): Promise<Recipe | null> {
  const row = must(await supabase().from('recipes').select(RECIPE_FIELDS).eq('id', id).maybeSingle()) as Recipe | null
  return row ? sortLines(row) : null
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
export async function deleteRecipe(id: string): Promise<void> {
  must(await supabase().from('recipes').delete().eq('id', id))
}
