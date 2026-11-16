// Продукти з довідника інгредієнтів у конструкторі меню: «Гречка 60 г» поруч зі стравою.
import type { Ingredient, Recipe, RecipeDraft } from '@/api/recipes'
import { PRODUCTS_MAX, type MealProduct } from './meals'
import { AISLES, servingsOf } from './shopping'
import { normalize } from './recipes'

/**
 * Порядок категорій у виборі продуктів: спершу те, що найчастіше йде окремо з грамовкою
 * (крупи, гарніри, овочі, фрукти, олії), далі — як відділи магазину.
 */
const FIRST = ['Крупи та хлібобулочні', 'Макарони', 'Овочі', 'Фрукти', 'Олії', 'Молочні продукти']
export const PRODUCT_CATEGORY_ORDER = [...FIRST, ...AISLES.filter((c) => !FIRST.includes(c))]

/** Короткі назви категорій для кнопок */
export const CATEGORY_SHORT: Record<string, string> = {
  'Крупи та хлібобулочні': 'Крупи й хліб',
  'Молочні продукти': 'Молочне',
  "М'ясо та птиця": "М'ясо",
  'Риба та морепродукти': 'Риба',
  'Горіхи та насіння': 'Горіхи',
  'Спеції та приправи': 'Спеції',
  'Напої та вода': 'Напої',
}

export const PRODUCT_UNITS = ['г', 'мл', 'шт'] as const

const QTY_MAX = 5000

export function productFromIngredient(i: Ingredient): MealProduct {
  return { ingredient_id: i.id, name: i.name, qty: null, unit: i.default_unit || 'г', category: i.category }
}

export const customProduct = (): MealProduct => ({ ingredient_id: null, name: '', qty: null, unit: 'г', category: null })

/** Грамовка порції: грами й мілілітри — цілими (дрібне — до десятих), штуки — до половинки */
export function roundQty(n: number, unit: string | null): number {
  if (unit === 'шт') return Math.max(0.5, Math.round(n * 2) / 2)
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10
}

// ---------------------------------------------------------------- загальна вага порції

/** Що входить у вагу: грами й мілілітри (мл ≈ г для страви); штуки й «за смаком» — ні */
const WEIGHT_UNITS = ['г', 'мл']
const weighed = (p: MealProduct) => p.qty !== null && !!p.unit && WEIGHT_UNITS.includes(p.unit)

/** Загальна вага порції, г */
export const portionWeight = (list: MealProduct[]) => Math.round(list.filter(weighed).reduce((s, p) => s + (p.qty ?? 0), 0))

/** Є продукти, які у вагу не входять (штуки) — показуємо підказку */
export const hasUnweighed = (list: MealProduct[]) => list.some((p) => p.qty !== null && !weighed(p))

/**
 * Задали іншу загальну вагу — грами й мілілітри перераховуються пропорційно,
 * штуки та «за смаком» лишаються як є.
 */
export function scaleToWeight(list: MealProduct[], target: number): MealProduct[] {
  const total = portionWeight(list)
  if (!total || !(target > 0)) return list
  const k = target / total
  const scaled = list.map((p) => (weighed(p) ? { ...p, qty: Math.min(roundQty((p.qty ?? 0) * k, p.unit), QTY_MAX) } : p))
  // різницю від округлення віддаємо найбільшому інгредієнту — сума точно дорівнює вписаній вазі
  const diff = Math.round(target) - portionWeight(scaled)
  const biggest = scaled.reduce<number>((at, p, i) => (weighed(p) && (at < 0 || (p.qty ?? 0) > (scaled[at]!.qty ?? 0)) ? i : at), -1)
  const big = scaled[biggest]
  if (diff && big && (big.qty ?? 0) + diff > 0) scaled[biggest] = { ...big, qty: Math.round(((big.qty ?? 0) + diff) * 10) / 10 }
  return scaled
}

type RecipeForPortion =Pick<Recipe, 'servings' | 'lines'>

/**
 * Склад однієї порції за рецептом — стартові грамовки, які нутриціолог править під клієнта.
 * Рецепт на N порцій ділимо на N; «200–250 г» беремо за нижньою межею; «за смаком» — без кількості.
 */
export function portionFromRecipe(recipe: RecipeForPortion, catalog: Ingredient[]): MealProduct[] {
  const servings = servingsOf(recipe.servings) ?? 1
  const byId = new Map(catalog.map((i) => [i.id, i]))
  return recipe.lines.slice(0, PRODUCTS_MAX).map((l) => {
    const known = l.ingredient_id ? byId.get(l.ingredient_id) : undefined
    const unit = l.unit ?? known?.default_unit ?? 'г'
    return {
      ingredient_id: l.ingredient_id,
      name: l.name,
      qty: l.qty_from === null ? null : roundQty(l.qty_from / servings, unit),
      unit,
      category: known?.category ?? null,
    }
  })
}

/** Продукт уже є в прийомі їжі: той самий з довідника або з тією ж назвою */
export const sameProduct = (a: Pick<MealProduct, 'ingredient_id' | 'name'>, b: Pick<MealProduct, 'ingredient_id' | 'name'>) =>
  (!!a.ingredient_id && a.ingredient_id === b.ingredient_id) || normalize(a.name) === normalize(b.name)

/**
 * Обрали інший рецепт: склад попереднього прибираємо, свої додані продукти (олія, овочі) лишаємо,
 * склад нового додаємо без повторів.
 */
export function switchRecipeProducts(current: MealProduct[], previous: MealProduct[], next: MealProduct[]): MealProduct[] {
  const own = current.filter((p) => !previous.some((q) => sameProduct(p, q)))
  return [...next, ...own.filter((p) => !next.some((q) => sameProduct(p, q)))].slice(0, PRODUCTS_MAX)
}

/** Рецепт для бази з продуктів прийому їжі: одна порція, грамовки як у меню */
export function recipeFromProducts(title: string, category: string | null, products: MealProduct[], instructions: string | null): RecipeDraft {
  return {
    title: title.trim(),
    category,
    servings: '1',
    instructions,
    notes: null,
    lines: cleanProducts(products).map((p) => ({ name: p.name, qty_from: p.qty, qty_to: null, unit: p.qty === null ? null : p.unit, note: null })),
  }
}

// Прості гарніри — сама крупа, макарони, картопля: у вкладці «Рецепти» → «Гарнір» їх показуємо першими
const PLAIN_GARNISH = /^(гречк|рис|крупа|булгур|кіноа|кускус|пшоно|перлов|ячн|вівсян|макарон|спагет|паста|локшин|картопл|кукурудзян)/

export const isGarnishCategory = (c: string | null) => !!c && normalize(c).startsWith('гарнір')

export const plainGarnishes = (list: Ingredient[]) =>
  list
    .filter((i) => PLAIN_GARNISH.test(normalize(i.name)) && !normalize(i.name).includes('борошн'))
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'))

/** «60», «60,5», «» → число або null; відʼємне й нечислове — null, завелике обрізаємо */
export function parseQty(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim())
  if (!raw.trim() || !Number.isFinite(n) || n < 0) return null
  return Math.min(Math.round(n * 10) / 10, QTY_MAX)
}

/** Перед збереженням: без порожніх рядків, обрізані назви, не більше PRODUCTS_MAX */
export const cleanProducts = (list: MealProduct[]): MealProduct[] =>
  list
    .map((p) => ({ ...p, name: p.name.trim().slice(0, 60), unit: p.unit?.trim() || null }))
    .filter((p) => p.name)
    .slice(0, PRODUCTS_MAX)

/** Категорії довідника з кількістю, у порядку PRODUCT_CATEGORY_ORDER; без категорії — в кінці */
export function productCategories(list: Ingredient[]): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const i of list) if (i.category) counts.set(i.category, (counts.get(i.category) ?? 0) + 1)
  const rank = (c: string) => {
    const i = PRODUCT_CATEGORY_ORDER.indexOf(c)
    return i < 0 ? PRODUCT_CATEGORY_ORDER.length : i
  }
  return [...counts]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'uk'))
    .map(([name, count]) => ({ name, count }))
}

/** Пошук за назвою чи синонімом: спершу збіг на початку назви */
export function searchProducts(list: Ingredient[], query: string): Ingredient[] {
  const q = normalize(query)
  const score = (i: Ingredient) =>
    normalize(i.name).startsWith(q)
      ? 0
      : normalize(i.name).includes(q) || i.aliases.some((a) => normalize(a).includes(q))
        ? 1
        : 9
  return list
    .map((i) => ({ i, s: score(i) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.i.name.localeCompare(b.i.name, 'uk'))
    .map((x) => x.i)
}
