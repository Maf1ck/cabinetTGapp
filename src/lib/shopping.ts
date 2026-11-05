// Список покупок із меню тижня: складаємо інгредієнти рецептів, групуємо за відділами магазину.
import { formatAmount, normalize } from './recipes'

/** Порядок відділів — як іти магазином: свіже, холодильник, сухе, спеції. */
export const AISLES = [
  'Овочі',
  'Зелень',
  'Фрукти',
  'Гриби',
  "М'ясо та птиця",
  'Риба та морепродукти',
  'Яйця',
  'Молочні продукти',
  'Крупи та хлібобулочні',
  'Макарони',
  'Бакалія',
  'Горіхи та насіння',
  'Сухофрукти',
  'Олії',
  'Спеції та приправи',
  'Напої та вода',
] as const

export const OTHER_AISLE = 'Інше'

export interface ShopRecipe {
  id: string
  servings: string | null
  lines: {
    name: string
    qty_from: number | null
    qty_to: number | null
    unit: string | null
    category: string | null
  }[]
}

export interface ShopLine {
  name: string
  /** «450 г», «2–3 шт», «300 г + 2 шт»; null — «за смаком» */
  amount: string | null
  category: string
}

/** «2–3» → 2, «2 перці» → 2; без числа — null (тоді рецепт = одна порція). */
export function servingsOf(s: string | null): number | null {
  const n = s?.match(/\d+/)?.[0]
  return n ? Math.max(1, Number(n)) : null
}

const round = (n: number) => Math.round(n * 10) / 10

/**
 * recipeIds — по одному на кожну страву меню (повтори = страва кілька разів на тиждень).
 * Рецепт на N порцій, що стоїть у меню M разів, готується ceil(M / N) разів.
 */
export function buildShoppingList(recipeIds: string[], recipes: Map<string, ShopRecipe>): ShopLine[] {
  const times = new Map<string, number>()
  for (const id of recipeIds) times.set(id, (times.get(id) ?? 0) + 1)

  type Acc = { name: string; category: string; byUnit: Map<string, { from: number; to: number }> }
  const acc = new Map<string, Acc>()

  for (const [id, n] of times) {
    const r = recipes.get(id)
    if (!r) continue
    const s = servingsOf(r.servings)
    const batches = s ? Math.ceil(n / s) : n
    for (const l of r.lines) {
      const key = normalize(l.name)
      const a = acc.get(key) ?? {
        name: l.name,
        category: l.category && (AISLES as readonly string[]).includes(l.category) ? l.category : OTHER_AISLE,
        byUnit: new Map(),
      }
      if (l.qty_from !== null) {
        const u = l.unit ?? ''
        const q = a.byUnit.get(u) ?? { from: 0, to: 0 }
        q.from += l.qty_from * batches
        q.to += (l.qty_to ?? l.qty_from) * batches
        a.byUnit.set(u, q)
      }
      acc.set(key, a)
    }
  }

  const order = (c: string) => {
    const i = (AISLES as readonly string[]).indexOf(c)
    return i < 0 ? AISLES.length : i
  }
  return [...acc.values()]
    .map((a) => {
      const parts = [...a.byUnit].map(([u, q]) => formatAmount(round(q.from), round(q.to), u || null)!)
      return { name: a.name, category: a.category, amount: parts.length ? parts.join(' + ') : null }
    })
    .sort((x, y) => order(x.category) - order(y.category) || x.name.localeCompare(y.name, 'uk'))
}
