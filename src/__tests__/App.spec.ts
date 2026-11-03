import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from '../App.vue'
import router from '../router'

describe('App', () => {
  it('показує головну і перекидає невідомі адреси на неї', async () => {
    router.push('/nope')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('home')
    expect(wrapper.find('h1').text()).toBe('Кабінет')
  })
})
