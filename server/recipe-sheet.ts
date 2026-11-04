// Розбір таблиці рецептів (recipes_db.xlsx) у рядки бази. Чиста логіка без IO —
// її тестуємо; читання файла й запис у Supabase — у scripts/recipes-import.ts.
import { createHash } from 'node:crypto'
import { formatAmount, normalize } from '../src/lib/recipes.js'

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

// ------------------------------------------------------------------ злиття з базою
// Нова таблиця нумерує рядки з 1, як і попередня, тож id з файла нічого не означають для бази.
// Звіряємо за назвою (без регістру й апострофів) і синонімами.

export interface Existing {
  ingredients: { id: string; name: string; aliases: string[] }[]
  recipes: { id: string; title: string; aliases: string[] }[]
}

export interface PlannedRecipe {
  row: RecipeRow
  /** new — нема в базі; existing — уже є (row.id = id з бази) */
  status: 'new' | 'existing'
  existingTitle?: string
}

export interface MergePlan {
  newIngredients: IngredientRow[]
  /** знайдені в базі інгредієнти, яким додаємо назви з нової таблиці як синоніми */
  ingredientAliases: { id: string; name: string; aliases: string[] }[]
  matchedIngredients: number
  recipes: PlannedRecipe[]
  /** однакові назви всередині самого файла — береться перша */
  duplicatesInFile: string[]
  lines: RecipeLineRow[]
}

const uniq = (xs: string[]) => {
  const seen = new Set<string>()
  return xs.filter((x) => {
    const k = normalize(x)
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export function planMerge(catalog: Catalog, existing: Existing): MergePlan {
  // ---- інгредієнти
  const dbIngredient = new Map<string, Existing['ingredients'][number]>()
  for (const i of existing.ingredients) for (const n of [i.name, ...i.aliases]) dbIngredient.set(normalize(n), i)

  const ingredientId = new Map<string, { id: string; name: string }>() // id з файла → у базі
  const newIngredients: IngredientRow[] = []
  const newByKey = new Map<string, IngredientRow>()
  const aliasAdds = new Map<string, { id: string; name: string; aliases: string[] }>()
  let matchedIngredients = 0

  for (const ing of catalog.ingredients) {
    const names = [ing.name, ...ing.aliases]
    const found = names.map((n) => dbIngredient.get(normalize(n))).find(Boolean)
    if (found) {
      matchedIngredients++
      ingredientId.set(ing.id, { id: found.id, name: found.name })
      const extra = names.filter((n) => !dbIngredient.has(normalize(n)))
      if (extra.length) {
        const entry = aliasAdds.get(found.id) ?? { id: found.id, name: found.name, aliases: [...found.aliases] }
        entry.aliases = uniq([...entry.aliases, ...extra])
        aliasAdds.set(found.id, entry)
        for (const n of extra) dbIngredient.set(normalize(n), found)
      }
      continue
    }
    const key = normalize(ing.name)
    const twin = newByKey.get(key)
    if (twin) {
      twin.aliases = uniq([...twin.aliases, ...ing.aliases])
      ingredientId.set(ing.id, { id: twin.id, name: twin.name })
      continue
    }
    const row = { ...ing, id: stableId(`ingredient-name:${key}`) }
    newIngredients.push(row)
    newByKey.set(key, row)
    for (const n of names) newByKey.set(normalize(n), row)
    ingredientId.set(ing.id, { id: row.id, name: row.name })
  }

  // ---- рецепти
  const dbRecipe = new Map<string, Existing['recipes'][number]>()
  for (const r of existing.recipes) for (const n of [r.title, ...r.aliases]) dbRecipe.set(normalize(n), r)

  const recipeId = new Map<string, string>() // id з файла → у базі
  const recipes: PlannedRecipe[] = []
  const inFile = new Set<string>()
  const duplicatesInFile: string[] = []

  for (const r of catalog.recipes) {
    const key = normalize(r.title)
    if (inFile.has(key)) {
      duplicatesInFile.push(r.title)
      continue
    }
    inFile.add(key)
    const found = dbRecipe.get(key)
    if (found) {
      recipeId.set(r.id, found.id)
      recipes.push({
        row: { ...r, id: found.id, aliases: uniq([...found.aliases, ...r.aliases]) },
        status: 'existing',
        existingTitle: found.title,
      })
    } else {
      const id = stableId(`recipe-title:${key}`)
      recipeId.set(r.id, id)
      recipes.push({ row: { ...r, id }, status: 'new' })
    }
  }

  const lines = catalog.lines.flatMap((l) => {
    const rid = recipeId.get(l.recipe_id)
    const ing = ingredientId.get(l.ingredient_id)
    return rid && ing ? [{ ...l, recipe_id: rid, ingredient_id: ing.id, name: ing.name }] : []
  })

  return {
    newIngredients,
    ingredientAliases: [...aliasAdds.values()],
    matchedIngredients,
    recipes,
    duplicatesInFile,
    lines,
  }
}
