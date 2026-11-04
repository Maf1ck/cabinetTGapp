import { describe, expect, it } from 'vitest'
import { buildCatalog, formatAmount, planMerge, SHEETS, stableId } from '../recipe-sheet'

const sheets = {
  [SHEETS.dishes]: [
    ['id', 'Назва', 'Категорія страви', 'Інші назви'],
    [1, 'Гречка з куркою', 'Основна страва', 'Гречка в духовці'],
  ],
  [SHEETS.ingredients]: [
    ['id', 'Назва', 'Категорія', 'Одиниця за замовчуванням', 'Інші назви в документах', 'Використовується в рецептах'],
    [10, 'Гречка', 'Крупи', 'г', null, 'так'],
    [11, 'Помідор', 'Овочі', 'г', 'Томат, Черрі', 'так'],
    [12, 'Сіль', 'Спеції', null, null, 'так'],
  ],
  [SHEETS.recipes]: [
    ['id', 'id страви', 'Страва', 'Порцій (за джерелом)', 'Інструкція (дослівно)', 'Джерело', 'Примітки', 'Що перевірити'],
    [1, 1, 'Гречка з куркою', '2–3', 'Запекти.', 'Раціон 1', null, 'Час не вказано'],
  ],
  [SHEETS.lines]: [
    ['id рецепта', 'Страва', 'id інгредієнта', 'Інгредієнт', 'Кількість (від)', 'Кількість (до)', 'Одиниця', 'Примітка', '№ у складі'],
    [1, 'Гречка з куркою', 10, 'Гречка', 100, null, 'г', 'суха', 1],
    [1, 'Гречка з куркою', 11, 'Помідор', 50, 60, 'г', '50–60 г', 2],
    [1, 'Гречка з куркою', 12, 'Сіль', null, null, null, 'за смаком', 3],
    [null, null, null, null, null, null, null, null, null],
  ],
}

describe('імпорт рецептів', () => {
  it('форматує кількість', () => {
    expect(formatAmount(40, null, 'г')).toBe('40 г')
    expect(formatAmount(2, 3, 'ст.л.')).toBe('2–3 ст.л.')
    expect(formatAmount(5, 5, 'шт')).toBe('5 шт')
    expect(formatAmount(null, null, 'г')).toBeNull()
  })

  it('дає стабільні UUID', () => {
    expect(stableId('recipe:1')).toBe(stableId('recipe:1'))
    expect(stableId('recipe:1')).not.toBe(stableId('recipe:2'))
    expect(stableId('recipe:1')).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
  })

  it('збирає каталог із аркушів', () => {
    const c = buildCatalog(sheets)
    expect(c.ingredients.find((i) => i.name === 'Помідор')?.aliases).toEqual(['Томат', 'Черрі'])
    expect(c.recipes).toEqual([
      expect.objectContaining({ title: 'Гречка з куркою', category: 'Основна страва', servings: '2–3', aliases: ['Гречка в духовці'] }),
    ])
    expect(c.lines.map((l) => [l.name, l.amount, l.note])).toEqual([
      ['Гречка', '100 г', 'суха'],
      ['Помідор', '50–60 г', null],
      ['Сіль', null, 'за смаком'],
    ])
    expect(c.lines.every((l) => l.recipe_id === c.recipes[0]!.id)).toBe(true)
    expect(c.toReview).toEqual([{ title: 'Гречка з куркою', text: 'Час не вказано' }])
  })

  it('падає на битому посиланні', () => {
    const broken = { ...sheets, [SHEETS.lines]: [sheets[SHEETS.lines][0]!, [1, '', 99, '', 1, null, 'г', null, 1]] }
    expect(() => buildCatalog(broken)).toThrow(/невідомий інгредієнт id=99/)
  })

  it('зливає з базою за назвою, а не за id файла', () => {
    const c = buildCatalog(sheets)
    const plan = planMerge(c, {
      ingredients: [
        { id: 'db-grechka', name: 'гречка', aliases: [] },
        { id: 'db-tomato', name: 'Томати', aliases: ['Томат'] },
      ],
      // той самий id, що дав би файл, але інша страва — не чіпаємо
      recipes: [{ id: stableId('recipe:1'), title: 'Омлет', aliases: [] }],
    })
    expect(plan.recipes).toHaveLength(1)
    expect(plan.recipes[0]!.status).toBe('new')
    expect(plan.recipes[0]!.row.id).not.toBe(stableId('recipe:1'))
    expect(plan.newIngredients.map((i) => i.name)).toEqual(['Сіль'])
    expect(plan.ingredientAliases).toEqual([{ id: 'db-tomato', name: 'Томати', aliases: ['Томат', 'Помідор', 'Черрі'] }])
    expect(plan.lines.map((l) => [l.ingredient_id, l.name])).toEqual([
      ['db-grechka', 'гречка'],
      ['db-tomato', 'Томати'],
      [plan.newIngredients[0]!.id, 'Сіль'],
    ])
  })

  it('впізнає рецепт, що вже є, і повтори у файлі', () => {
    const doubled = {
      ...sheets,
      [SHEETS.recipes]: [...sheets[SHEETS.recipes], [2, null, 'гречка з КУРКОЮ', null, null, null, null, null]],
    }
    const plan = planMerge(buildCatalog(doubled), {
      ingredients: [],
      recipes: [{ id: 'db-1', title: 'Гречка зі шматочками', aliases: ['Гречка з куркою'] }],
    })
    expect(plan.recipes.map((r) => [r.status, r.row.id, r.existingTitle])).toEqual([
      ['existing', 'db-1', 'Гречка зі шматочками'],
    ])
    expect(plan.duplicatesInFile).toEqual(['гречка з КУРКОЮ'])
    expect(plan.lines.every((l) => l.recipe_id === 'db-1')).toBe(true)
  })
})
