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
