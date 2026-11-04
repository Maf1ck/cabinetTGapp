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
