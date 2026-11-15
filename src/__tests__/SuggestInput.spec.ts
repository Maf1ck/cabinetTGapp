import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SuggestInput from '../components/SuggestInput.vue'

const options = [
  { value: 'Масло вершкове 82%', hint: 'Молочні продукти' },
  { value: 'Олія оливкова', hint: 'Олії', keys: ['оливкова олія'] },
  { value: 'Гречка', hint: 'Крупи' },
]

// v-model, як у батьківському компоненті
function mountInput() {
  const w = mount(SuggestInput, {
    props: { modelValue: '', options, 'onUpdate:modelValue': (v: string | null) => w.setProps({ modelValue: v }) },
    attachTo: document.body,
  })
  return w
}

describe('SuggestInput', () => {
  it('показує збіги з підсвіткою й підписом, без нативного datalist', async () => {
    const w = mountInput()
    const input = w.find('input')
    await input.setValue('масло')
    const items = w.findAll('[role="option"]')
    expect(items).toHaveLength(1)
    expect(items[0]!.find('mark').text()).toBe('Масло')
    expect(items[0]!.text()).toContain('Молочні продукти')
    expect(w.find('datalist').exists()).toBe(false)
    expect(input.attributes('aria-expanded')).toBe('true')
    w.unmount()
  })

  it('збіг лише з початку слова', async () => {
    const w = mount(SuggestInput, {
      props: {
        modelValue: '',
        options: [{ value: 'Тефтелі з рисом' }, { value: 'Швидка і корисна піца' }, { value: 'Рис' }],
        'onUpdate:modelValue': (v: string | null) => w.setProps({ modelValue: v }),
      },
    })
    await w.find('input').setValue('рис')
    expect(w.findAll('[role="option"]').map((o) => o.text())).toEqual(['Рис', 'Тефтелі з рисом'])
  })

  it('шукає й за синонімом; стрілка вниз і Enter обирають підказку', async () => {
    const w = mountInput()
    const input = w.find('input')
    await input.setValue('оливкова олія')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(w.emitted('pick')).toEqual([['Олія оливкова']])
    expect(w.props('modelValue')).toBe('Олія оливкова')
    expect(input.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('Esc закриває список і не пускає подію далі (вікно з полем не закривається)', async () => {
    const w = mountInput()
    const input = w.find('input')
    await input.setValue('гре')
    let reachedParent = false
    const onKey = () => (reachedParent = true)
    document.body.addEventListener('keydown', onKey)
    input.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await w.vm.$nextTick()
    document.body.removeEventListener('keydown', onKey)
    expect(reachedParent).toBe(false)
    expect(input.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })
})
