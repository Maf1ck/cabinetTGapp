// Розбір таблиці рецептів (recipes_db.xlsx) у рядки бази. Чиста логіка без IO —
// її тестуємо; читання файла й запис у Supabase — у scripts/recipes-import.ts.
import { createHash } from 'node:crypto'
import { formatAmount } from '../src/lib/recipes.js'

export type Cell = string | number | boolean | null | unknown
export type Sheet = Cell[][]

export const SHEETS = {
  dishes: 'Страви',
  ingredients: 'Інгредієнти',
  recipes: 'Рецепти',
  lines: 'Склад рецептів',
} as const

export interface IngredientRow {
  id: string
  name: string
  category: string | null
  default_unit: string | null
  aliases: string[]
}

export interface RecipeRow {
  id: string
  title: string
  category: string | null
  aliases: string[]
  servings: string | null
  instructions: string | null
  source: string | null
  notes: string | null
}

export interface RecipeLineRow {
  recipe_id: string
  ingredient_id: string
  name: string
  amount: string | null
  qty_from: number | null
  qty_to: number | null
  unit: string | null
  note: string | null
  position: number
}

export interface Catalog {
  ingredients: IngredientRow[]
  recipes: RecipeRow[]
  lines: RecipeLineRow[]
  /** «Що перевірити» з таблиці — у базу не йде (її читають і клієнти), показуємо нутриціологу в консолі */
  toReview: { title: string; text: string }[]
}

/** Стабільний UUID із ключа: повторний імпорт оновлює ті самі рядки, а не плодить дублікати. */
export function stableId(key: string): string {
  const h = createHash('sha1').update(`cabinet:${key}`).digest('hex')
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const text = (v: Cell): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

const num = (v: Cell): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const list = (v: Cell): string[] =>
  (text(v) ?? '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)

export { formatAmount }

/** Рядки аркуша як об'єкти за назвами колонок; падає, якщо колонки нема. */
function records<K extends string>(sheet: Sheet, name: string, columns: readonly K[]): Record<K, Cell>[] {
  const [header, ...rows] = sheet
  const titles = (header ?? []).map((h) => text(h))
  const index = Object.fromEntries(
    columns.map((c) => {
      const i = titles.indexOf(c)
      if (i < 0) throw new Error(`Аркуш «${name}»: немає колонки «${c}»`)
      return [c, i]
    }),
  ) as Record<K, number>
  return rows
    .filter((r) => r.some((c) => text(c) !== null))
    .map((r) => Object.fromEntries(columns.map((c) => [c, r[index[c]] ?? null])) as Record<K, Cell>)
}

export function buildCatalog(sheets: Record<string, Sheet>): Catalog {
  const sheet = (name: string) => {
    const s = sheets[name]
    if (!s) throw new Error(`У файлі немає аркуша «${name}»`)
    return s
  }

  const ingredients = records(sheet(SHEETS.ingredients), SHEETS.ingredients, [
    'id',
    'Назва',
    'Категорія',
    'Одиниця за замовчуванням',
    'Інші назви в документах',
  ] as const).map((r) => ({
    key: text(r.id)!,
    row: {
      id: stableId(`ingredient:${text(r.id)}`),
      name: text(r['Назва'])!,
      category: text(r['Категорія']),
      default_unit: text(r['Одиниця за замовчуванням']),
      aliases: list(r['Інші назви в документах']),
    } satisfies IngredientRow,
  }))
  const ingredientByKey = new Map(ingredients.map((i) => [i.key, i.row]))

  const dishes = new Map(
    records(sheet(SHEETS.dishes), SHEETS.dishes, ['id', 'Назва', 'Категорія страви', 'Інші назви'] as const).map(
      (r) => [text(r.id)!, r],
    ),
  )

  const recipeByKey = new Map<string, RecipeRow>()
  const toReview: Catalog['toReview'] = []
  for (const r of records(sheet(SHEETS.recipes), SHEETS.recipes, [
    'id',
    'id страви',
    'Страва',
    'Порцій (за джерелом)',
    'Інструкція (дослівно)',
    'Джерело',
    'Примітки',
    'Що перевірити',
  ] as const)) {
    const dish = dishes.get(text(r['id страви']) ?? '')
    const title = text(dish?.['Назва']) ?? text(r['Страва'])
    if (!title) throw new Error(`Рецепт id=${text(r.id)}: немає назви страви`)
    recipeByKey.set(text(r.id)!, {
      id: stableId(`recipe:${text(r.id)}`),
      title,
      category: text(dish?.['Категорія страви']),
      aliases: list(dish?.['Інші назви']),
      servings: text(r['Порцій (за джерелом)']),
      instructions: text(r['Інструкція (дослівно)']),
      source: text(r['Джерело']),
      notes: text(r['Примітки']),
    })
    const review = text(r['Що перевірити'])
    if (review) toReview.push({ title, text: review })
  }

  const lines: RecipeLineRow[] = records(sheet(SHEETS.lines), SHEETS.lines, [
    'id рецепта',
    'id інгредієнта',
    'Кількість (від)',
    'Кількість (до)',
    'Одиниця',
    'Примітка',
    '№ у складі',
  ] as const).map((r, i) => {
    const recipe = recipeByKey.get(text(r['id рецепта']) ?? '')
    const ingredient = ingredientByKey.get(text(r['id інгредієнта']) ?? '')
    if (!recipe) throw new Error(`Склад, рядок ${i + 2}: невідомий рецепт id=${text(r['id рецепта'])}`)
    if (!ingredient) throw new Error(`Склад, рядок ${i + 2}: невідомий інгредієнт id=${text(r['id інгредієнта'])}`)
    const from = num(r['Кількість (від)'])
    const to = num(r['Кількість (до)'])
    const unit = text(r['Одиниця'])
    const amount = formatAmount(from, to, unit)
    const note = text(r['Примітка'])
    return {
      recipe_id: recipe.id,
      ingredient_id: ingredient.id,
      name: ingredient.name,
      amount,
      qty_from: from,
      qty_to: to !== null && to !== from ? to : null,
      unit,
      note: note === amount ? null : note, // «50–60 г» у примітці лише дублює кількість
      position: num(r['№ у складі']) ?? i,
    }
  })

  return { ingredients: ingredients.map((i) => i.row), recipes: [...recipeByKey.values()], lines, toReview }
}
