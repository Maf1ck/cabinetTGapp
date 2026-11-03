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
