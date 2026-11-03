import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import router from '../router'

// Без збереженої сесії і без звернень до справжньої Supabase
vi.mock('../lib/supabase', () => ({
  supabase: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => {},
    },
  }),
}))

describe('App', () => {
  it('без сесії веде на вхід і памʼятає, куди хотіли', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    router.push('/nope')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [pinia, router] } })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.next).toBe('/')
    expect(wrapper.find('button').text()).toContain('Увійти через Telegram')
  })
})
