import { describe, expect, it } from 'vitest'
import { buildShoppingList, servingsOf, type ShopRecipe } from '@/lib/shopping'

const recipes = new Map<string, ShopRecipe>([
  [
    'omelet',
    {
      id: 'omelet',
      servings: '1',
      lines: [
        { name: 'Яйця', qty_from: 2, qty_to: null, unit: 'шт', category: 'Яйця' },
        { name: 'Помідор', qty_from: 50, qty_to: 60, unit: 'г', category: 'Овочі' },
        { name: 'Сіль', qty_from: null, qty_to: null, unit: null, category: 'Спеції та приправи' },
      ],
    },
  ],
  [
    'stew',
    {
      id: 'stew',
      servings: '2–3',
      lines: [
        { name: 'помідор', qty_from: 200, qty_to: null, unit: 'г', category: 'Овочі' },
        { name: 'Яйця', qty_from: 1, qty_to: null, unit: 'шт', category: 'Яйця' },
        { name: 'Щось', qty_from: 1, qty_to: null, unit: 'ст.л.', category: null },
      ],
    },
  ],
])

describe('список покупок', () => {
  it('читає порції', () => {
    expect(servingsOf('2–3')).toBe(2)
    expect(servingsOf('2 перці')).toBe(2)
    expect(servingsOf(null)).toBeNull()
  })

  it('складає продукти з урахуванням порцій і групує за відділами', () => {
    // омлет на 1 порцію двічі → 2 рази; рагу на 2 порції тричі → 2 рази
    const list = buildShoppingList(['omelet', 'stew', 'omelet', 'stew', 'stew'], recipes)
    expect(list).toEqual([
      { name: 'Помідор', amount: '500–520 г', category: 'Овочі' },
      { name: 'Яйця', amount: '6 шт', category: 'Яйця' },
      { name: 'Сіль', amount: null, category: 'Спеції та приправи' },
      { name: 'Щось', amount: '2 ст.л.', category: 'Інше' },
    ])
  })

  it('пропускає невідомі рецепти', () => {
    expect(buildShoppingList(['nope'], recipes)).toEqual([])
  })
})
