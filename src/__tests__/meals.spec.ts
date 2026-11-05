import { describe, expect, it } from 'vitest'
import { dueMeals, type MealType } from '@/lib/meals'

const m = (meal: MealType, at_time: string | null = null) => ({ meal, at_time, title: meal })
const menu = [m('dinner'), m('breakfast', '08:00:00'), m('lunch', '13:30:00'), m('snack1')]

describe('dueMeals — що вже можна записати в щоденник', () => {
  const now = new Date(2026, 10, 5, 13, 10)

  it('сьогодні: лише страви, чий час настав (з запасом 30 хв), за часом', () => {
    expect(dueMeals(menu, new Date(2026, 10, 5), now).map((x) => x.meal)).toEqual(['breakfast', 'snack1', 'lunch'])
  })

  it('минулий день — усі страви', () => {
    expect(dueMeals(menu, new Date(2026, 10, 4), now)).toHaveLength(4)
  })

  it('майбутній день — нічого', () => {
    expect(dueMeals(menu, new Date(2026, 10, 6), now)).toEqual([])
  })

  it('рано вранці — ще нічого', () => {
    expect(dueMeals(menu, new Date(2026, 10, 5), new Date(2026, 10, 5, 6, 0))).toEqual([])
  })
})
