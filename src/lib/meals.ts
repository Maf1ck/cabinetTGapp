export type MealType = 'breakfast' | 'snack1' | 'lunch' | 'snack2' | 'dinner'

export const MEALS: MealType[] = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner']

export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: 'Сніданок',
  snack1: 'Перекус',
  lunch: 'Обід',
  snack2: 'Перекус',
  dinner: 'Вечеря',
}

/** '08:30:00' → '08:30' */
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')

// ---------------------------------------------------------------- продукти з грамовкою

/** Продукт у прийомі їжі поруч зі стравою або замість неї: «Гречка 60 г». */
export interface MealProduct {
  /** з довідника інгредієнтів; null — вписано вручну */
  ingredient_id: string | null
  name: string
  /** null — без кількості («за смаком») */
  qty: number | null
  unit: string | null
  /** відділ магазину для списку покупок */
  category: string | null
}

export const PRODUCTS_MAX = 30

/** «Гречка — 60 г»; без кількості — лише назва */
export const productLabel = (p: Pick<MealProduct, 'name' | 'qty' | 'unit'>) =>
  p.qty === null ? p.name : `${p.name} — ${p.qty}${p.unit ? ` ${p.unit}` : ''}`

/** Назва прийому їжі, коли страви немає, а є лише продукти: «Гречка, Огірок, Олія оливкова» */
export const titleFromProducts = (products: Pick<MealProduct, 'name'>[]) =>
  products
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 120)

/** Чернетки й рядки, збережені до появи продуктів, їх не мають */
export const productsOf = (m: { products?: MealProduct[] | null }): MealProduct[] => m.products ?? []

type WithProducts = { title: string; products?: MealProduct[] | null }

/** У страви своя назва (а не складена з продуктів, коли страви немає) */
export const hasOwnTitle = (m: WithProducts) => m.title !== titleFromProducts(productsOf(m))

/** «Гречка — 60 г · Огірок — 150 г» */
export const productsLine = (m: WithProducts) => productsOf(m).map(productLabel).join(' · ')

interface MealContent {
  id: string
  day: number
  meal: string
  at_time: string | null
  title: string
  recipe_id: string | null
  products?: MealProduct[] | null
}

const productsKey = (m: MealContent) => productsOf(m).map((p) => `${p.ingredient_id ?? ''}:${p.name}:${p.qty ?? ''}:${p.unit ?? ''}`)

// час з бази приходить як 08:30:00, з форми як 08:30
const mealKey = (m: MealContent) =>
  [m.day, m.meal, hhmm(m.at_time), m.title, m.recipe_id, ...productsKey(m)].join('|')

/** Страви чернетки, яких нема в збереженому меню або які в ньому інші. */
export function changedMealIds(saved: MealContent[], next: MealContent[]): Set<string> {
  const before = new Map(saved.map((m) => [m.id, mealKey(m)]))
  return new Set(next.filter((m) => before.get(m.id) !== mealKey(m)).map((m) => m.id))
}

export const sameMeals = (saved: MealContent[], next: MealContent[]) =>
  saved.length === next.length && changedMealIds(saved, next).size === 0

/** Звичайний час прийому їжі: підставляється в нову страву чи запис */
export const MEAL_TIME: Record<MealType, string> = {
  breakfast: '08:30',
  snack1: '11:30',
  lunch: '14:00',
  snack2: '17:00',
  dinner: '19:00',
}

/** Який прийом їжі найімовірніше зараз */
export function mealByTime(d: Date): MealType {
  const m = d.getHours() * 60 + d.getMinutes()
  if (m < 10 * 60) return 'breakfast'
  if (m < 12 * 60 + 30) return 'snack1'
  if (m < 16 * 60) return 'lunch'
  if (m < 18 * 60 + 30) return 'snack2'
  return 'dinner'
}

const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Час страви: з меню, а якщо не вказано — звичайний для прийому їжі */
export const mealMinutes = (m: { meal: MealType; at_time: string | null }) => minutes(m.at_time ?? MEAL_TIME[m.meal])

/** За скільки хвилин до часу страви її вже можна записати в щоденник */
export const DUE_EARLY_MIN = 30

/**
 * Страви дня, які вже «настали»: за минулий день — усі, за сьогодні — ті, чий час
 * прийшов (з невеликим запасом), за майбутній — жодної. Порядок — за часом.
 */
export function dueMeals<T extends { meal: MealType; at_time: string | null }>(meals: T[], date: Date, now: Date): T[] {
  const day = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate()
  if (day(date) > day(now)) return []
  const limit = day(date) < day(now) ? Infinity : now.getHours() * 60 + now.getMinutes() + DUE_EARLY_MIN
  return meals.filter((m) => mealMinutes(m) <= limit).sort((a, b) => mealMinutes(a) - mealMinutes(b))
}

// ---------------------------------------------------------------- звіт «зʼїдено» (клієнти на супроводі)

/** Скільки символів коментаря до страви приймає форма звіту */
export const REPORT_NOTE_MAX = 500

/**
 * Нотатка запису щоденника для страви з меню: назва страви і коментар клієнта.
 * Без коментаря — лише назва (тоді звітом є фото).
 */
export const reportNote = (title: string, comment: string) => {
  const c = comment.trim()
  return c ? `${title} — ${c}` : title
}

/**
 * Коли записати звіт: сьогоднішню або майбутню страву — зараз, минулу — на її час у меню
 * (щоб запис потрапив у щоденник саме того дня).
 */
export function reportTime(
  weekMonday: Date,
  m: { day: number; meal: MealType; at_time: string | null },
  now: Date,
): Date {
  const y = weekMonday.getFullYear()
  const date = new Date(y, weekMonday.getMonth(), weekMonday.getDate() + m.day - 1)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (date >= today) return now
  const min = mealMinutes(m)
  date.setHours(Math.floor(min / 60), min % 60)
  return date
}
