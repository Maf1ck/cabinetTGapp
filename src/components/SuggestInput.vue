<script lang="ts">
export interface Suggestion {
  value: string
  /** дрібний підпис праворуч: категорія, «рецепт» */
  hint?: string | null
  /** інші назви, за якими теж шукати (синоніми з довідника) */
  keys?: string[]
}
</script>

<script setup lang="ts">
// Поле з підказками замість нативного <datalist>: той самий вигляд у всіх браузерах,
// збіг підсвічений, клавіатура (↑ ↓ Enter Esc) і мишка.
// Атрибути (placeholder, aria-label, maxlength, required, @input, @change) йдуть на сам input.
import { computed, ref, useId } from 'vue'
import { normalize } from '@/lib/recipes'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    options: Suggestion[]
    /** показати весь список при фокусі, ще до введення (короткі списки: категорії) */
    openOnFocus?: boolean
    limit?: number
  }>(),
  { openOnFocus: false, limit: 8 },
)
const model = defineModel<string | null>({ required: true })
// typed — після кожного введеного символу, коли модель уже оновлена; pick — обрали підказку
const emit = defineEmits<{ pick: [value: string]; typed: [value: string] }>()

const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const active = ref(-1)
const listId = `suggest-${useId()}`

const query = computed(() => normalize(model.value ?? ''))

const matches = computed(() => {
  const q = query.value
  if (!q) return props.openOnFocus ? props.options.slice(0, 50) : []
  // збіг на початку слова: «рис» знайде «Тефтелі з рисом», але не «корисна»
  const atWord = (s: string) => {
    const n = normalize(s)
    return n.startsWith(q) || n.includes(` ${q}`)
  }
  const score = (o: Suggestion) =>
    normalize(o.value).startsWith(q) ? 0 : atWord(o.value) ? 1 : o.keys?.some(atWord) ? 2 : 9
  return props.options
    .map((o) => ({ o, s: score(o) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.o.value.localeCompare(b.o.value, 'uk'))
    .slice(0, props.limit)
    .map((x) => x.o)
})

// єдиний збіг, що вже вписаний повністю, — підказувати нічого
const shown = computed(() =>
  open.value && matches.value.length && !(matches.value.length === 1 && normalize(matches.value[0]!.value) === query.value)
    ? matches.value
    : [],
)

/** «Гре|чка» → частини для підсвітки збігу */
function parts(value: string) {
  const q = (model.value ?? '').trim().toLocaleLowerCase('uk')
  const at = q ? value.toLocaleLowerCase('uk').indexOf(q) : -1
  return at < 0 ? { before: value, match: '', after: '' } : { before: value.slice(0, at), match: value.slice(at, at + q.length), after: value.slice(at + q.length) }
}

function show() {
  open.value = true
  active.value = -1
}

// приведення типу — тут, не в Pug: TS-синтаксис у шаблоні Pug ламається в браузері
function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  model.value = value
  show()
  emit('typed', value)
}

function choose(o: Suggestion) {
  model.value = o.value
  open.value = false
  active.value = -1
  emit('pick', o.value)
}

function onKeydown(e: KeyboardEvent) {
  const list = shown.value
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!open.value) show()
    if (!list.length) return
    e.preventDefault()
    const step = e.key === 'ArrowDown' ? 1 : -1
    active.value = (active.value + step + list.length) % list.length
  } else if (e.key === 'Enter' && list.length && active.value >= 0) {
    e.preventDefault()
    choose(list[active.value]!)
  } else if (e.key === 'Escape' && list.length) {
    // спершу закриваємо список, а не вікно, в якому стоїть поле
    e.stopPropagation()
    open.value = false
  }
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template lang="pug">
.suggest
  input(
    v-bind='$attrs'
    ref='input'
    :value='model ?? ""'
    type='text'
    role='combobox'
    autocomplete='off'
    aria-autocomplete='list'
    :aria-expanded='shown.length > 0'
    :aria-controls='listId'
    :aria-activedescendant='active >= 0 && shown.length ? `${listId}-${active}` : undefined'
    @input='onInput'
    @focus='show'
    @click='show'
    @blur='open = false'
    @keydown='onKeydown'
  )
  ul.suggest__list(v-show='shown.length' :id='listId' role='listbox')
    li.suggest__option(
      v-for='(o, i) in shown'
      :id='`${listId}-${i}`'
      :key='o.value'
      role='option'
      :aria-selected='i === active'
      :class='{ "is-active": i === active }'
      @mousedown.prevent='choose(o)'
      @mousemove='active = i'
    )
      span.suggest__value
        | {{ parts(o.value).before }}
        mark(v-if='parts(o.value).match') {{ parts(o.value).match }}
        | {{ parts(o.value).after }}
      small.suggest__hint(v-if='o.hint') {{ o.hint }}
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.suggest {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;

  > input {
    width: 100%;
  }

  &__list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    width: 100%;
    min-width: 220px;
    max-height: 264px;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    border: 1px solid $line-green;
    border-radius: $radius-item;
    background: $bg;
    box-shadow: 0 10px 28px rgba(20, 38, 27, 0.14);
    list-style: none;
  }

  &__option {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 12px;
    border-radius: 10px;
    color: $text;
    font-size: 14px;
    line-height: 1.3;
    cursor: pointer;

    &.is-active {
      background: $bg-active;
      color: $text-active;
    }
  }

  &__value {
    min-width: 0;

    mark {
      background: none;
      color: inherit;
      font-weight: 700;
    }
  }

  &__hint {
    flex: none;
    color: $text-faint;
    font-size: 12px;
  }
}
</style>
