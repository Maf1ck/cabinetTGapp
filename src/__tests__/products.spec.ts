import { describe, expect, it } from 'vitest'
import type { Ingredient, RecipeLine } from '@/api/recipes'
import type { MealProduct } from '@/lib/meals'
import {
  cleanProducts,
  isGarnishCategory,
  parseQty,
  plainGarnishes,
  portionFromRecipe,
  productCategories,
  productFromIngredient,
  recipeFromProducts,
  roundQty,
  searchProducts,
  switchRecipeProducts,
} from '@/lib/products'

const ing = (name: string, category: string | null, unit: string | null = 'г', aliases: string[] = []): Ingredient => ({
  id: name,
  name,
  category,
  default_unit: unit,
  aliases,
})

const catalog = [
  ing('Огірок', 'Овочі'),
  ing('Гречка', 'Крупи та хлібобулочні'),
  ing('Олія оливкова', 'Олії', 'мл'),
  ing('Яблуко', 'Фрукти', 'шт'),
  ing('Куряче філе', "М'ясо та птиця"),
  ing('Рис', 'Крупи та хлібобулочні', 'г', ['рис білий']),
  ing('Щось', null),
]

describe('продукти в конструкторі меню', () => {
  it('кількість: кома, порожнє, відʼємне, завелике', () => {
    expect(parseQty('60')).toBe(60)
    expect(parseQty('60,5')).toBe(60.5)
    expect(parseQty(' ')).toBeNull()
    expect(parseQty('abc')).toBeNull()
    expect(parseQty('-5')).toBeNull()
    expect(parseQty('999999')).toBe(5000)
  })

  it('продукт із довідника бере одиницю й відділ; без одиниці — грами', () => {
    expect(productFromIngredient(catalog[2]!)).toEqual({
      ingredient_id: 'Олія оливкова',
      name: 'Олія оливкова',
      qty: null,
      unit: 'мл',
      category: 'Олії',
    })
    expect(productFromIngredient(ing('Сіль', null, null)).unit).toBe('г')
  })

  it('перед збереженням прибирає порожні рядки й зайві пробіли', () => {
    const cleaned = cleanProducts([
      { ingredient_id: null, name: '  Гречка суха ', qty: 60, unit: 'г', category: null },
      { ingredient_id: null, name: '   ', qty: 10, unit: 'г', category: null },
    ])
    expect(cleaned).toEqual([{ ingredient_id: null, name: 'Гречка суха', qty: 60, unit: 'г', category: null }])
  })

  it('категорії: спершу крупи, овочі, фрукти, олії, далі решта', () => {
    expect(productCategories(catalog).map((c) => c.name)).toEqual([
      'Крупи та хлібобулочні',
      'Овочі',
      'Фрукти',
      'Олії',
      "М'ясо та птиця",
    ])
    expect(productCategories(catalog)[0]!.count).toBe(2)
  })

  it('пошук за назвою і синонімом, збіг на початку — вище', () => {
    expect(searchProducts(catalog, 'ол').map((i) => i.name)).toEqual(['Олія оливкова'])
    expect(searchProducts(catalog, 'білий').map((i) => i.name)).toEqual(['Рис'])
    // «о»: спершу ті, що починаються з «о», потім ті, де «о» всередині
    expect(searchProducts(catalog, 'о').map((i) => i.name)).toEqual(['Огірок', 'Олія оливкова', 'Щось', 'Яблуко'])
  })
})

const line = (name: string, qty: number | null, unit: string | null, ingredient_id: string | null = null): RecipeLine => ({
  id: name,
  ingredient_id,
  name,
  amount: null,
  qty_from: qty,
  qty_to: null,
  unit,
  note: null,
  position: 0,
})
const product = (name: string, qty: number | null = null): MealProduct => ({ ingredient_id: null, name, qty, unit: 'г', category: null })

describe('склад рецепта на одну порцію', () => {
  it('ділить на кількість порцій і округлює: грами цілими, штуки до половинки', () => {
    const portion = portionFromRecipe(
      {
        servings: '4 порції',
        lines: [line('Гречка', 250, 'г', 'Гречка'), line('Яйце', 3, 'шт'), line('Олія оливкова', 10, 'мл'), line('Сіль', null, null)],
      },
      catalog,
    )
    expect(portion).toEqual([
      { ingredient_id: 'Гречка', name: 'Гречка', qty: 63, unit: 'г', category: 'Крупи та хлібобулочні' },
      { ingredient_id: null, name: 'Яйце', qty: 1, unit: 'шт', category: null },
      { ingredient_id: null, name: 'Олія оливкова', qty: 2.5, unit: 'мл', category: null },
      { ingredient_id: null, name: 'Сіль', qty: null, unit: 'г', category: null },
    ])
    // без числа порцій — рецепт і є порція
    expect(portionFromRecipe({ servings: null, lines: [line('Рис', 70, 'г')] }, catalog)[0]!.qty).toBe(70)
    expect(roundQty(0.2, 'шт')).toBe(0.5)
  })

  it('інший рецепт: склад попереднього прибирається, свої продукти лишаються, без повторів', () => {
    const next = switchRecipeProducts(
      [product('Гречка', 70), product('Гриби', 100), product('Огірок', 150)],
      [product('Гречка', 60), product('Гриби', 100)],
      [product('Рис', 60), product('огірок', 50)],
    )
    expect(next.map((p) => `${p.name} ${p.qty}`)).toEqual(['Рис 60', 'огірок 50'])
  })

  it('рецепт із продуктів: одна порція, без порожніх рядків; без кількості — без одиниці', () => {
    expect(recipeFromProducts(' Рис відварний ', 'Гарнір', [product('Рис', 50), product(' '), product('Сіль')], null)).toEqual({
      title: 'Рис відварний',
      category: 'Гарнір',
      servings: '1',
      instructions: null,
      notes: null,
      lines: [
        { name: 'Рис', qty_from: 50, qty_to: null, unit: 'г', note: null },
        { name: 'Сіль', qty_from: null, qty_to: null, unit: null, note: null },
      ],
    })
  })

  it('прості гарніри: крупи, макарони, картопля — без борошна й іншого', () => {
    const list = [...catalog, ing('Макарони з твердих сортів пшениці', 'Макарони'), ing('Картопля', 'Овочі'), ing('Рисове борошно', 'Крупи та хлібобулочні')]
    expect(plainGarnishes(list).map((i) => i.name)).toEqual(['Гречка', 'Картопля', 'Макарони з твердих сортів пшениці', 'Рис'])
    expect(isGarnishCategory('Гарніри')).toBe(true)
    expect(isGarnishCategory('Сніданок')).toBe(false)
  })
})
