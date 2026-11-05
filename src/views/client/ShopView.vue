<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import AppIcon from '@/components/AppIcon.vue'
import {
  addShoppingItem,
  deleteShoppingItem,
  getShoppingList,
  setShoppingAllChecked,
  setShoppingChecked,
  type ShoppingItem,
} from '@/api/client'
import { addDays, isoDate, shortDate, weekStart } from '@/lib/dates'
import { AISLES, OTHER_AISLE } from '@/lib/shopping'

const OWN = 'Додано вами'

const auth = useAuth()
const clientId = auth.account!.clientId!

const thisMonday = weekStart(new Date())
const monday = ref(thisMonday)
const isThisWeek = computed(() => isoDate(monday.value) === isoDate(thisMonday))
const range = computed(() => `${shortDate(monday.value)} — ${shortDate(addDays(monday.value, 6))}`)

const loading = ref(true)
const loadError = ref(false)
const saveError = ref(false)
const items = ref<ShoppingItem[]>([])
const hasMenu = ref(false)
const withoutRecipe = ref<string[]>([])
const hideChecked = ref(false)
const draft = ref('')
const adding = ref(false)
const shared = ref(false)

const done = computed(() => items.value.filter((i) => i.checked).length)
const groups = computed(() => {
  const order = [...AISLES, OTHER_AISLE, OWN] as string[]
  const map = new Map<string, ShoppingItem[]>()
  for (const i of items.value) {
    if (hideChecked.value && i.checked) continue
    const g = i.from_menu ? (i.category ?? OTHER_AISLE) : OWN
    map.set(g, [...(map.get(g) ?? []), i])
  }
  return [...map]
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([name, list]) => ({ name, list }))
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const r = await getShoppingList(clientId, isoDate(monday.value))
    items.value = r.items
    hasMenu.value = r.hasMenu
    withoutRecipe.value = r.withoutRecipe
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function toggle(item: ShoppingItem) {
  item.checked = !item.checked
  saveError.value = false
  try {
    await setShoppingChecked(item.id, item.checked)
  } catch {
    item.checked = !item.checked
    saveError.value = true
  }
}

async function uncheckAll() {
  const ids = items.value.filter((i) => i.checked).map((i) => i.id)
  saveError.value = false
  try {
    await setShoppingAllChecked(ids, false)
    for (const i of items.value) i.checked = false
  } catch {
    saveError.value = true
  }
}

/** «Хліб, 1 шт» → назва «Хліб», кількість «1 шт» */
async function add() {
  const [name, ...rest] = draft.value.split(',')
  const title = name?.trim()
  if (!title) return
  adding.value = true
  saveError.value = false
  try {
    items.value.push(await addShoppingItem(clientId, isoDate(monday.value), title, rest.join(',').trim() || null))
    draft.value = ''
  } catch {
    saveError.value = true
  } finally {
    adding.value = false
  }
}

async function remove(item: ShoppingItem) {
  saveError.value = false
  try {
    await deleteShoppingItem(item.id)
    items.value = items.value.filter((i) => i.id !== item.id)
  } catch {
    saveError.value = true
  }
}

/** Відправити список собі чи рідним у Telegram (або скопіювати) */
async function share() {
  const left = items.value.filter((i) => !i.checked)
  const text = [`Покупки на ${range.value}:`, ...left.map((i) => `• ${i.name}${i.amount ? ` — ${i.amount}` : ''}`)].join('\n')
  try {
    if (navigator.share) await navigator.share({ text })
    else {
      await navigator.clipboard.writeText(text)
      shared.value = true
      setTimeout(() => (shared.value = false), 2000)
    }
  } catch {
    // людина закрила вікно «Поділитися»
  }
}

watch(monday, load, { immediate: true })
</script>

<template lang="pug">
main.page.shop
  .page-head
    div
      .page-head__sub З вашого меню · {{ range }}
      h1.page-head__title Список покупок
    .page-head__actions
      .shop__week
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Попередній тиждень' @click='monday = addDays(monday, -7)')
          AppIcon(name='chevronLeft' :size='18')
        button.btn.btn--sm(type='button' :class='isThisWeek ? "btn--soft" : "btn--ghost"' :disabled='isThisWeek' @click='monday = thisMonday') Цей тиждень
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Наступний тиждень' @click='monday = addDays(monday, 7)')
          AppIcon(name='chevronRight' :size='18')

  p.notice(v-if='saveError' role='alert') Не вдалося зберегти. Спробуйте ще раз.

  p.empty(v-if='loading') Збираємо список…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити список.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз

  template(v-else)
    section.card.shop__bar(v-if='items.length')
      .shop__progress
        b {{ done }} з {{ items.length }}
        span куплено
        .shop__meter: span(:style='{ width: `${(done / items.length) * 100}%` }')
      .shop__tools
        label.shop__toggle
          input(v-model='hideChecked' type='checkbox')
          | Сховати куплене
        button.btn.btn--ghost.btn--sm(v-if='done' type='button' @click='uncheckAll') Зняти всі відмітки
        button.btn.btn--soft.btn--sm(type='button' @click='share') {{ shared ? 'Скопійовано ✓' : 'Поділитися' }}

    p.empty(v-if='!hasMenu && !items.length') Меню на цей тиждень ще не опубліковане — список зʼявиться разом із ним. Поки можна додати своє 👇

    .shop__groups
      section.card.shop__group(v-for='g in groups' :key='g.name')
        h2.shop__aisle {{ g.name }} #[span {{ g.list.length }}]
        .shop__item(v-for='i in g.list' :key='i.id' :class='{ "is-on": i.checked }')
          label
            input(type='checkbox' :checked='i.checked' @change='toggle(i)')
            span.shop__name {{ i.name }}
            span.shop__amount(v-if='i.amount') {{ i.amount }}
            span.shop__amount.shop__amount--loose(v-else-if='i.from_menu') за смаком
          button.shop__remove(v-if='!i.from_menu' type='button' :aria-label='`Видалити: ${i.name}`' @click='remove(i)')
            AppIcon(name='close' :size='14')

    p.empty(v-if='hideChecked && items.length && done === items.length') Усе куплено 🎉

    form.card.shop__add(@submit.prevent='add')
      label.field
        | Додати своє
        input(v-model='draft' type='text' maxlength='80' placeholder='Напр.: хліб житній, 1 шт' autocomplete='off')
      button.btn.btn--primary(type='submit' :disabled='adding || !draft.trim()') Додати

    p.shop__note(v-if='hasMenu')
      | Кількості — на всі страви тижня з урахуванням порцій рецепта. Список оновлюється сам, коли Анастасія змінює меню.
      template(v-if='withoutRecipe.length')
        br
        | Без рецепта (інгредієнтів у списку немає): {{ withoutRecipe.join(', ') }}.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.shop {
  &__week {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  &__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  &__progress {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    min-width: 200px;

    b {
      font-family: $font-heading;
      font-size: 24px;
      font-weight: 500;
    }

    span {
      color: $text-muted;
      font-size: 14px;
    }
  }

  &__meter {
    flex-basis: 100%;
    height: 6px;
    overflow: hidden;
    border-radius: $pill;
    background: $bg-tint;

    span {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: $accent;
      transition: width 0.25s ease-out;
    }
  }

  &__tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  &__toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    cursor: pointer;

    input {
      width: 18px;
      height: 18px;
      accent-color: $accent;
    }
  }

  &__groups {
    columns: 2 320px;
    column-gap: 14px;
  }

  &__group {
    break-inside: avoid;
    margin-bottom: 14px;
  }

  &__aisle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 8px;
    font-family: $font-body;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: $text-muted;

    span {
      padding: 1px 8px;
      border-radius: $pill;
      background: $bg-soft;
      font-weight: 600;
      letter-spacing: 0;
    }
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid $line-soft;

    &:last-child {
      border-bottom: 0;
    }

    label {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      cursor: pointer;
    }

    input {
      flex: none;
      width: 20px;
      height: 20px;
      accent-color: $accent;
    }

    &.is-on .shop__name {
      color: $text-faint;
      text-decoration: line-through;
    }
  }

  &__name {
    flex: 1;
  }

  &__amount {
    color: $text-muted;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;

    &--loose {
      color: $text-faint;
      font-style: italic;
    }
  }

  &__remove {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: $text-faint;
    cursor: pointer;

    &:hover {
      background: $bg-soft;
      color: $text;
    }
  }

  &__add {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;

    .field {
      flex: 1;
      min-width: 220px;
    }
  }

  &__note {
    margin: 0;
    color: $text-faint;
    font-size: 13px;
  }
}
</style>
