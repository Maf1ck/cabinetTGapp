import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import router from '../router'

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
