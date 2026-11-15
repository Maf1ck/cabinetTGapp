import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import BuilderView from '../views/nutri/BuilderView.vue'
import type * as Nutri from '../api/nutri'
import type * as Recipes from '../api/recipes'

const nutri = vi.hoisted(() => ({
  listClients: vi.fn<typeof Nutri.listClients>(),
  getMenuForEdit: vi.fn<typeof Nutri.getMenuForEdit>(),
  ensureMenu: vi.fn<typeof Nutri.ensureMenu>(),
  saveMenuDraft: vi.fn<typeof Nutri.saveMenuDraft>(),
  discardMenuDraft: vi.fn<typeof Nutri.discardMenuDraft>(),
  publishMenu: vi.fn<typeof Nutri.publishMenu>(),
  hideMenu: vi.fn<typeof Nutri.hideMenu>(),
}))
const recipes = vi.hoisted(() => ({
  listRecipes: vi.fn<typeof Recipes.listRecipes>(),
  listIngredients: vi.fn<typeof Recipes.listIngredients>(),
  getRecipe: vi.fn<typeof Recipes.getRecipe>(),
  saveRecipe: vi.fn<typeof Recipes.saveRecipe>(),
}))
vi.mock('../api/nutri', () => nutri)
vi.mock('../api/recipes', () => recipes)
vi.mock('../lib/supabase', () => ({ supabase: () => ({}) }))

const client = {
  id: 'c1',
  full_name: 'Олена Коваль',
  goal: null,
  program_title: null,
  program_week: null,
  program_weeks: null,
  on_support: false,
  active: true,
  user_id: null,
  created_at: '2026-11-01',
} as unknown as Nutri.ClientRow

const emptyMenu: Nutri.EditableMenu = { id: 'm1', published: false, meals: [], saved: [], hasDraft: false }

async function mountBuilder() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/n/builder', component: BuilderView }] })
  await router.push('/n/builder')
  const wrapper = mount(BuilderView, { global: { plugins: [router], stubs: { RouterLink: RouterLinkStub, Transition: false } } })
  await flushPromises()
  return wrapper
}

describe('конструктор меню: продукти з грамовкою', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nutri.listClients.mockResolvedValue([client])
    nutri.getMenuForEdit.mockResolvedValue(emptyMenu)
    nutri.saveMenuDraft.mockResolvedValue()
    recipes.listRecipes.mockResolvedValue([])
    recipes.listIngredients.mockResolvedValue([
      { id: 'buckwheat', name: 'Гречка', category: 'Крупи та хлібобулочні', default_unit: 'г', aliases: [] },
      { id: 'oil', name: 'Олія оливкова', category: 'Олії', default_unit: 'мл', aliases: [] },
      { id: 'cucumber', name: 'Огірок', category: 'Овочі', default_unit: 'г', aliases: [] },
    ])
  })

  it('додає гречку з вкладки «Продукти» з власною вагою, без страви', async () => {
    const w = await mountBuilder()
    await w.find('button.builder__cell').trigger('click')

    const tab = w.findAll('.builder__tabs button').find((b) => b.text() === 'Продукти')!
    await tab.trigger('click')
    // перша категорія — крупи
    expect(w.find('.builder__cats button.is-on').text()).toContain('Крупи')

    const buckwheat = w.findAll('.builder__list button').find((b) => b.text().includes('Гречка'))!
    await buckwheat.trigger('click')
    await w.find('.meal-products__qty').setValue('60')
    await w.find('.meal-products__name').setValue('Гречка суха')

    await w.find('form.builder__dialog').trigger('submit')
    await flushPromises()

    expect(nutri.saveMenuDraft).toHaveBeenCalledTimes(1)
    const [, meals] = nutri.saveMenuDraft.mock.calls[0]!
    expect(meals).toHaveLength(1)
    expect(meals[0]).toMatchObject({
      title: 'Гречка суха',
      recipe_id: null,
      products: [{ ingredient_id: 'buckwheat', name: 'Гречка суха', qty: 60, unit: 'г', category: 'Крупи та хлібобулочні' }],
    })
    // у клітинці — продукт із грамовкою
    expect(w.find('.builder__products').text()).toBe('Гречка суха — 60 г')
  })

  it('страва і продукти разом; той самий продукт двічі не додається', async () => {
    const w = await mountBuilder()
    await w.find('button.builder__cell').trigger('click')
    await w.find('.builder__dialog-main .suggest input').setValue('Курка запечена')

    await w.findAll('.builder__tabs button').find((b) => b.text() === 'Продукти')!.trigger('click')
    await w.find('.builder__book-search input').setValue('ол')
    const oil = w.findAll('.builder__list button').find((b) => b.text().includes('Олія'))!
    await oil.trigger('click')
    await oil.trigger('click')
    expect(w.findAll('.meal-products__row')).toHaveLength(1)
    await w.find('.meal-products__qty').setValue('5')

    await w.find('form.builder__dialog').trigger('submit')
    await flushPromises()

    const [, meals] = nutri.saveMenuDraft.mock.calls[0]!
    expect(meals[0]).toMatchObject({
      title: 'Курка запечена',
      products: [{ name: 'Олія оливкова', qty: 5, unit: 'мл' }],
    })
  })
})

const buckwheatWithMushrooms: Recipes.Recipe = {
  id: 'r1',
  title: 'Гречка з грибами',
  category: 'Гарнір',
  servings: '2',
  instructions: 'Відварити гречку, обсмажити гриби.',
  notes: null,
  source: null,
  aliases: [],
  photo_path: null,
  photo_credit: null,
  photo_source: null,
  photoUrl: null,
  lines: [
    { id: 'l1', ingredient_id: 'buckwheat', name: 'Гречка', amount: '120 г', qty_from: 120, qty_to: null, unit: 'г', note: null, position: 1 },
    { id: 'l2', ingredient_id: null, name: 'Печериці', amount: '200–250 г', qty_from: 200, qty_to: 250, unit: 'г', note: null, position: 2 },
    { id: 'l3', ingredient_id: null, name: 'Сіль', amount: null, qty_from: null, qty_to: null, unit: null, note: 'за смаком', position: 3 },
  ],
}

describe('конструктор меню: склад рецепта з грамовкою на порцію', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nutri.listClients.mockResolvedValue([client])
    nutri.getMenuForEdit.mockResolvedValue(emptyMenu)
    nutri.saveMenuDraft.mockResolvedValue()
    recipes.listRecipes.mockResolvedValue([
      { id: 'r1', title: 'Гречка з грибами', category: 'Гарнір', aliases: [], ingredients: ['Гречка', 'Печериці', 'Сіль'] },
    ])
    recipes.listIngredients.mockResolvedValue([
      { id: 'buckwheat', name: 'Гречка', category: 'Крупи та хлібобулочні', default_unit: 'г', aliases: [] },
      { id: 'rice', name: 'Рис', category: 'Крупи та хлібобулочні', default_unit: 'г', aliases: [] },
      { id: 'flour', name: 'Рисове борошно', category: 'Крупи та хлібобулочні', default_unit: 'г', aliases: [] },
      { id: 'oil', name: 'Олія оливкова', category: 'Олії', default_unit: 'мл', aliases: [] },
    ])
    recipes.getRecipe.mockResolvedValue(buckwheatWithMushrooms)
  })

  it('обрали рецепт — склад підставився на одну порцію, грамовку можна змінити', async () => {
    const w = await mountBuilder()
    await w.find('button.builder__cell').trigger('click')
    await w.findAll('.builder__list button').find((b) => b.text().includes('Гречка з грибами'))!.trigger('click')
    await flushPromises()

    const qty = w.findAll<HTMLInputElement>('.meal-products__qty')
    // рецепт на 2 порції: 120 г → 60 г, «200–250 г» → 100 г, «за смаком» — без кількості
    expect(qty.map((i) => i.element.value)).toEqual(['60', '100', ''])
    await qty[0]!.setValue('70')

    await w.find('form.builder__dialog').trigger('submit')
    await flushPromises()
    const [, meals] = nutri.saveMenuDraft.mock.calls[0]!
    expect(meals[0]).toMatchObject({
      title: 'Гречка з грибами',
      recipe_id: 'r1',
      products: [
        { ingredient_id: 'buckwheat', name: 'Гречка', qty: 70, unit: 'г', category: 'Крупи та хлібобулочні' },
        { name: 'Печериці', qty: 100, unit: 'г' },
        { name: 'Сіль', qty: null },
      ],
    })
  })

  it('у «Гарнір» спершу прості крупи; страву з продуктів можна зберегти як рецепт', async () => {
    recipes.saveRecipe.mockImplementation(async (draft) => ({
      ...buckwheatWithMushrooms,
      id: 'r2',
      title: draft.title,
      category: draft.category,
      servings: draft.servings,
      instructions: draft.instructions,
      lines: draft.lines.map((l, i) => ({ ...l, id: `n${i}`, ingredient_id: `ing-${i}`, amount: null, position: i + 1 })),
    }))
    const w = await mountBuilder()
    await w.find('button.builder__cell').trigger('click')
    // рецепти → категорія «Гарнір»
    await w.findAll('.builder__cats button').find((b) => b.text().startsWith('Гарнір'))!.trigger('click')
    const names = w.findAll('.builder__list button b').map((b) => b.text())
    expect(names.slice(0, 2)).toEqual(['Гречка', 'Рис'])
    expect(names).not.toContain('Рисове борошно')

    await w.findAll('.builder__list button').find((b) => b.text().startsWith('Рис'))!.trigger('click')
    await w.find('.meal-products__qty').setValue('50')
    await w.find('.builder__save-as-open').trigger('click')
    await w.find('.builder__save-as input').setValue('Рис відварний')
    await w.findAll('.builder__save-as button').find((b) => b.text() === 'Зберегти рецепт')!.trigger('click')
    await flushPromises()

    expect(recipes.saveRecipe).toHaveBeenCalledTimes(1)
    expect(recipes.saveRecipe.mock.calls[0]![0]).toMatchObject({
      title: 'Рис відварний',
      category: 'Гарнір',
      servings: '1',
      lines: [{ name: 'Рис', qty_from: 50, qty_to: null, unit: 'г' }],
    })
    // страва тепер привʼязана до нового рецепта
    expect(w.find('.builder__recipe').text()).toContain('Рецепт із бази')
    expect(w.find<HTMLInputElement>('.builder__dialog-main .suggest input').element.value).toBe('Рис відварний')
  })
})
