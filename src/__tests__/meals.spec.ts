import { describe, expect, it } from 'vitest'
import {
  changedMealIds,
  dueMeals,
  hasOwnTitle,
  productLabel,
  productsLine,
  reportNote,
  reportTime,
  sameMeals,
  titleFromProducts,
  type MealProduct,
  type MealType,
} from '@/lib/meals'

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

describe('чернетка меню', () => {
  const soup = { id: 'a', day: 1, meal: 'lunch', at_time: '13:00:00', title: 'Суп', recipe_id: null }

  it('час із бази і з форми вважає однаковим', () => {
    expect(sameMeals([soup], [{ ...soup, at_time: '13:00' }])).toBe(true)
  })

  it('знаходить нові й змінені страви', () => {
    const next = [{ ...soup, title: 'Борщ' }, { ...soup, id: 'b' }]
    expect([...changedMealIds([soup], next)]).toEqual(['a', 'b'])
  })

  it('видалену страву теж вважає зміною', () => {
    expect(sameMeals([soup], [])).toBe(false)
  })

  it('зміну грамовки чи продукту вважає зміною; старі страви без продуктів = порожній список', () => {
    const buckwheat: MealProduct = { ingredient_id: 'g', name: 'Гречка', qty: 60, unit: 'г', category: null }
    const withProducts = { ...soup, products: [buckwheat] }
    expect(sameMeals([soup], [{ ...soup, products: [] }])).toBe(true)
    expect(sameMeals([withProducts], [{ ...soup, products: [{ ...buckwheat }] }])).toBe(true)
    expect(sameMeals([withProducts], [{ ...soup, products: [{ ...buckwheat, qty: 80 }] }])).toBe(false)
    expect(sameMeals([soup], [withProducts])).toBe(false)
  })
})

describe('продукти з грамовкою', () => {
  const p = (name: string, qty: number | null, unit: string | null = 'г'): MealProduct => ({
    ingredient_id: null,
    name,
    qty,
    unit,
    category: null,
  })

  it('підпис: назва — кількість одиниця; без кількості — лише назва', () => {
    expect(productLabel(p('Гречка', 60))).toBe('Гречка — 60 г')
    expect(productLabel(p('Олія оливкова', 5, 'мл'))).toBe('Олія оливкова — 5 мл')
    expect(productLabel(p('Яблуко', 1, null))).toBe('Яблуко — 1')
    expect(productLabel(p('Зелень', null))).toBe('Зелень')
  })

  it('без страви назва складається з продуктів, і тоді своєї назви немає', () => {
    const products = [p('Гречка', 60), p('Огірок', 150)]
    expect(titleFromProducts(products)).toBe('Гречка, Огірок')
    expect(hasOwnTitle({ title: 'Гречка, Огірок', products })).toBe(false)
    expect(hasOwnTitle({ title: 'Курка з овочами', products })).toBe(true)
    expect(productsLine({ title: 'x', products })).toBe('Гречка — 60 г · Огірок — 150 г')
    expect(productsLine({ title: 'x' })).toBe('')
  })
})

describe('звіт про зʼїдену страву', () => {
  const monday = new Date(2026, 10, 2)
  const now = new Date(2026, 10, 5, 13, 10)

  it('нотатка: назва страви і коментар клієнта', () => {
    expect(reportNote('Вівсянка', '  зʼїла половину ')).toBe('Вівсянка — зʼїла половину')
    expect(reportNote('Вівсянка', '   ')).toBe('Вівсянка')
  })

  it('минула страва — на її час у меню', () => {
    const lunch = { day: 2, meal: 'lunch', at_time: '13:30:00' } as const
    expect(reportTime(monday, lunch, now)).toEqual(new Date(2026, 10, 3, 13, 30))
    const dinner = { day: 1, meal: 'dinner', at_time: null } as const
    expect(reportTime(monday, dinner, now)).toEqual(new Date(2026, 10, 2, 19, 0))
  })

  it('сьогоднішня й майбутня — зараз', () => {
    expect(reportTime(monday, { day: 4, meal: 'dinner', at_time: null }, now)).toBe(now)
    expect(reportTime(monday, { day: 6, meal: 'lunch', at_time: null }, now)).toBe(now)
  })
})
