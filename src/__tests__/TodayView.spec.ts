import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import TodayView from '../views/client/TodayView.vue'
import { useAuth } from '../stores/auth'
import { isoDate, weekday } from '../lib/dates'
import type * as Api from '../api/client'

const api = vi.hoisted(() => ({
  getClientCard: vi.fn<typeof Api.getClientCard>(),
  getNextAppointment: vi.fn<typeof Api.getNextAppointment>(),
  getWater: vi.fn<typeof Api.getWater>(),
  getWellbeing: vi.fn<typeof Api.getWellbeing>(),
  getWeekMenu: vi.fn<typeof Api.getWeekMenu>(),
  getShopping: vi.fn<typeof Api.getShopping>(),
  getHabitsWeek: vi.fn<typeof Api.getHabitsWeek>(),
  getDiaryDays: vi.fn<typeof Api.getDiaryDays>(),
  setWater: vi.fn<typeof Api.setWater>(),
  setWellbeing: vi.fn<typeof Api.setWellbeing>(),
  setMealEaten: vi.fn<typeof Api.setMealEaten>(),
  setShoppingChecked: vi.fn<typeof Api.setShoppingChecked>(),
  setHabitDone: vi.fn<typeof Api.setHabitDone>(),
}))
vi.mock('../api/client', () => api)
vi.mock('../lib/supabase', () => ({ supabase: () => ({}) }))

const today = new Date()
const meal = (id: string, title: string, eaten = false): Api.Meal => ({
  id,
  day: weekday(today),
  meal: 'lunch',
  at_time: '14:00:00',
  title,
  recipe_id: null,
  eaten,
})

function mountView() {
  return mount(TodayView, { global: { stubs: { RouterLink: RouterLinkStub } } })
}

describe('TodayView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useAuth().account = { userId: 'u', telegramId: 1, role: 'client', firstName: 'Марія', clientId: 'c1' }
    vi.clearAllMocks()
    api.getClientCard.mockResolvedValue({ id: 'c1', full_name: 'Марія Кравець', goal: null, program_title: 'Супровід', program_week: 3, program_weeks: 4 })
    api.getNextAppointment.mockResolvedValue(null)
    api.getWater.mockResolvedValue(3)
    api.getWellbeing.mockResolvedValue({ energy: 4, sleep: null, digestion: null, mood: null })
    api.getWeekMenu.mockResolvedValue([meal('m1', 'Курка, булгур, салат', true), meal('m2', 'Запечена риба')])
    api.getShopping.mockResolvedValue([{ id: 's1', name: 'Булгур', amount: null, checked: false }])
    api.getHabitsWeek.mockResolvedValue([])
    api.getDiaryDays.mockResolvedValue([isoDate(today)])
    for (const f of [api.setWater, api.setWellbeing, api.setMealEaten, api.setShoppingChecked, api.setHabitDone])
      f.mockResolvedValue(undefined)
  })

  it('показує вітання, воду, меню й серію щоденника', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.find('h1').text()).toMatch(/, Марія!$/)
    expect(w.text()).toContain('0,75 з 2 л')
    expect(w.text()).toContain('1 день поспіль')
    expect(w.findAll('.today__glasses .is-on')).toHaveLength(3)
    expect(w.findAll('.today__meal')).toHaveLength(2)
    // «зараз» — перша нез'їдена страва
    expect(w.find('.today__meal--now').text()).toContain('Запечена риба')
  })

  it('додає склянку води і зберігає', async () => {
    const w = mountView()
    await flushPromises()
    await w.find('.today__water-actions .btn--soft').trigger('click')
    expect(w.findAll('.today__glasses .is-on')).toHaveLength(4)
    expect(api.setWater).toHaveBeenCalledWith('c1', isoDate(today), 4)
  })

  it('повертає відмітку і показує помилку, якщо зберегти не вдалося', async () => {
    api.setMealEaten.mockRejectedValue(new Error('offline'))
    const w = mountView()
    await flushPromises()
    const btn = w.findAll('.today__eaten')[1]!
    await btn.trigger('click')
    await flushPromises()
    expect(btn.classes()).not.toContain('is-on')
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })

  it('каже, що меню ще готується, якщо його не опублікували', async () => {
    api.getWeekMenu.mockResolvedValue(null)
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Меню на цей тиждень ще готується')
  })
})
