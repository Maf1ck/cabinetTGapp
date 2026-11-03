import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import router from '../router'
import { useAuth, type Account } from '../stores/auth'

// Без звернень до справжньої Supabase: запити сторінок падають і ловляться як «не вдалося завантажити»
vi.mock('../lib/supabase', () => ({
  supabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => {},
    },
  }),
}))

const as = (role: Account['role']) => {
  const auth = useAuth()
  auth.init = async () => {}
  auth.account = { userId: 'u', telegramId: 1, role, firstName: 'Тест', clientId: role === 'client' ? 'c' : null }
}

describe('App', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('без сесії веде на вхід і памʼятає, куди хотіли', async () => {
    await router.push('/nope')
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/')
    expect(wrapper.find('button').text()).toContain('Увійти через Telegram')
    wrapper.unmount()
  })

  it('клієнта з головної і зі сторінок нутриціолога веде в його кабінет', async () => {
    as('client')
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/c')
    await router.push('/n/clients')
    expect(router.currentRoute.value.path).toBe('/c')
  })

  it('нутриціолога веде в робочий кабінет', async () => {
    as('nutri')
    await router.push('/')
    expect(router.currentRoute.value.path).toBe('/n')
    await router.push('/c/menu')
    expect(router.currentRoute.value.path).toBe('/n')
    await router.push('/n/payments')
    expect(router.currentRoute.value.path).toBe('/n/payments')
  })
})
