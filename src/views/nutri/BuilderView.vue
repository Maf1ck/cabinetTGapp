<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import {
  copyMenu,
  deleteMeal,
  ensureMenu,
  getMenuForEdit,
  listClients,
  saveMeal,
  setMenuPublished,
  type ClientRow,
  type EditableMeal,
  type EditableMenu,
} from '@/api/nutri'
import { addDays, DAY_SHORT, isoDate, plural, shortDate, weekStart } from '@/lib/dates'
import { hhmm, MEAL_LABEL, MEAL_TIME, MEALS, type MealType } from '@/lib/meals'
import { shortName } from '@/lib/clients'

const route = useRoute()
const router = useRouter()

const now = new Date()
const thisMonday = weekStart(now)
const monday = ref(thisMonday)
const clients = ref<ClientRow[]>([])
const clientId = ref<string>('')
const menu = ref<EditableMenu | null>(null)

const loading = ref(true)
const menuLoading = ref(false)
const error = ref('')
const busy = ref(false)

// редактор клітинки
const editor = ref<{ day: number; meal: MealType; id?: string; title: string; time: string } | null>(null)
const titleInput = ref<HTMLInputElement | null>(null)

const activeClients = computed(() => clients.value.filter((c) => c.active))
const client = computed(() => clients.value.find((c) => c.id === clientId.value) ?? null)
const weekIso = computed(() => isoDate(monday.value))
const range = computed(() => `${shortDate(monday.value)} — ${shortDate(addDays(monday.value, 6))}`)
const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday.value, i)
    return { day: i + 1, date, today: isoDate(date) === isoDate(now) }
  }),
)
const meals = computed(() => menu.value?.meals ?? [])
const cell = (day: number, meal: MealType) => meals.value.find((m) => m.day === day && m.meal === meal)
const perDay = (day: number) => meals.value.filter((m) => m.day === day).length
// підказки для поля «страва»: усе, що вже є в цьому меню
const suggestions = computed(() => [...new Set(meals.value.map((m) => m.title))].sort((a, b) => a.localeCompare(b, 'uk')))

async function loadClients() {
  loading.value = true
  try {
    clients.value = await listClients()
    const wanted = typeof route.query.client === 'string' ? route.query.client : ''
    clientId.value = activeClients.value.find((c) => c.id === wanted)?.id ?? activeClients.value[0]?.id ?? ''
  } catch {
    error.value = 'Не вдалося завантажити клієнтів.'
  } finally {
    loading.value = false
  }
}

async function loadMenu() {
  if (!clientId.value) return
  menuLoading.value = true
  error.value = ''
  try {
    menu.value = await getMenuForEdit(clientId.value, weekIso.value)
  } catch {
    error.value = 'Не вдалося завантажити меню.'
  } finally {
    menuLoading.value = false
  }
}

async function run(task: () => Promise<void>, message: string) {
  busy.value = true
  error.value = ''
  try {
    await task()
  } catch {
    error.value = message
  } finally {
    busy.value = false
  }
}

function openEditor(day: number, meal: MealType) {
  const existing = cell(day, meal)
  editor.value = {
    day,
    meal,
    id: existing?.id,
    title: existing?.title ?? '',
    time: existing?.at_time ? hhmm(existing.at_time) : MEAL_TIME[meal],
  }
  nextTick(() => titleInput.value?.focus())
}

function saveEditor() {
  const e = editor.value
  if (!e) return
  const title = e.title.trim()
  if (!title) return removeFromEditor()
  run(async () => {
    const target = menu.value ?? (await ensureMenu(clientId.value, weekIso.value))
    const saved = await saveMeal(target.id, { id: e.id, day: e.day, meal: e.meal, at_time: e.time || null, title })
    const rest = target.meals.filter((m) => m.id !== saved.id)
    menu.value = { ...target, meals: [...rest, saved] }
    editor.value = null
  }, 'Не вдалося зберегти страву.')
}

function removeFromEditor() {
  const e = editor.value
  if (!e?.id) {
    editor.value = null
    return
  }
  const id = e.id
  run(async () => {
    await deleteMeal(id)
    if (menu.value) menu.value = { ...menu.value, meals: menu.value.meals.filter((m) => m.id !== id) }
    editor.value = null
  }, 'Не вдалося видалити страву.')
}

function togglePublished() {
  const m = menu.value
  if (!m) return
  const next = !m.published
  if (next && !m.meals.length) {
    error.value = 'Додайте хоча б одну страву, перш ніж надсилати меню.'
    return
  }
  run(async () => {
    await setMenuPublished(m.id, next)
    menu.value = { ...m, published: next }
  }, 'Не вдалося змінити публікацію.')
}

function copyPrevious() {
  if (meals.value.length && !window.confirm('Замінити страви цього тижня стравами з попереднього?')) return
  run(async () => {
    const copied = await copyMenu(clientId.value, isoDate(addDays(monday.value, -7)), weekIso.value)
    if (!copied) error.value = 'Минулого тижня меню для цього клієнта не було.'
    else menu.value = copied
  }, 'Не вдалося скопіювати меню.')
}

const shiftWeek = (delta: number) => (monday.value = addDays(monday.value, delta * 7))

watch([clientId, weekIso], () => {
  editor.value = null
  if (clientId.value) router.replace({ query: { ...route.query, client: clientId.value } })
  loadMenu()
})

onMounted(loadClients)

const cellLabel = (m: EditableMeal | undefined, day: number, meal: MealType) =>
  m ? `${MEAL_LABEL[meal]}, ${DAY_SHORT[day - 1]}: ${m.title}. Змінити` : `Додати: ${MEAL_LABEL[meal]}, ${DAY_SHORT[day - 1]}`
</script>

<template lang="pug">
main.page.builder
  .page-head
    div
      .page-head__sub Меню на тиждень для клієнта
      h1.page-head__title Конструктор меню
    .page-head__actions(v-if='menu')
      span.builder__state(:class='{ "is-live": menu.published }') {{ menu.published ? 'Опубліковано' : 'Чернетка' }}
      button.btn(type='button' :class='menu.published ? "btn--ghost" : "btn--primary"' :disabled='busy' @click='togglePublished')
        | {{ menu.published ? 'Сховати від клієнта' : 'Надіслати клієнту' }}

  p.empty(v-if='loading') Завантажуємо…
  .card(v-else-if='!activeClients.length')
    p.empty
      | Спершу додайте клієнта.
      |
      RouterLink(:to='{ path: "/n/clients", query: { new: "1" } }') Новий клієнт

  template(v-else)
    .card.builder__toolbar
      label.field.builder__client
        | Клієнт
        select(v-model='clientId')
          option(v-for='c in activeClients' :key='c.id' :value='c.id') {{ shortName(c.full_name) }}{{ c.goal ? ` · ${c.goal}` : '' }}
      .builder__period
        span.builder__label Тиждень
        .builder__week
          button.btn.btn--ghost.btn--sm.builder__arrow(type='button' aria-label='Попередній тиждень' @click='shiftWeek(-1)')
            AppIcon(name='chevronLeft' :size='18')
          b {{ range }}
          button.btn.btn--ghost.btn--sm.builder__arrow(type='button' aria-label='Наступний тиждень' @click='shiftWeek(1)')
            AppIcon(name='chevronRight' :size='18')
      button.btn.btn--ghost.btn--sm(type='button' :disabled='busy' @click='copyPrevious') Скопіювати з минулого тижня

    p.notice(v-if='error' role='alert') {{ error }}

    section.card
      p.empty(v-if='menuLoading') Завантажуємо меню…
      template(v-else)
        p.builder__hint(v-if='!meals.length') Натисніть на клітинку, щоб додати страву. Меню побачить {{ client ? shortName(client.full_name) : 'клієнт' }} лише після «Надіслати клієнту».
        .builder__scroll
          .builder__grid
            div
            .builder__day(v-for='d in weekDays' :key='d.day' :class='{ "is-today": d.today }')
              span {{ DAY_SHORT[d.day - 1] }}
              b {{ d.date.getDate() }}
            template(v-for='t in MEALS' :key='t')
              .builder__type {{ MEAL_LABEL[t] }}
              button.builder__cell(
                v-for='d in weekDays'
                :key='`${t}-${d.day}`'
                type='button'
                :class='{ "is-empty": !cell(d.day, t), "is-editing": editor?.day === d.day && editor?.meal === t }'
                :aria-label='cellLabel(cell(d.day, t), d.day, t)'
                @click='openEditor(d.day, t)'
              )
                template(v-if='cell(d.day, t)')
                  span.builder__time(v-if='cell(d.day, t)!.at_time') {{ hhmm(cell(d.day, t)!.at_time) }}
                  span {{ cell(d.day, t)!.title }}
                AppIcon(v-else name='plus' :size='18')
            .builder__type.builder__type--muted Разом
            .builder__total(v-for='d in weekDays' :key='`sum-${d.day}`' :class='{ "is-warn": perDay(d.day) === 0 }')
              | {{ perDay(d.day) ? `${perDay(d.day)} ${plural(perDay(d.day), 'прийом', 'прийоми', 'прийомів')}` : 'Порожньо' }}

  //- редактор страви
  Transition(name='builder-dialog')
    .builder__overlay(v-if='editor' @click.self='editor = null' @keydown.esc='editor = null')
      form.builder__dialog(role='dialog' aria-modal='true' :aria-label='`${MEAL_LABEL[editor.meal]}, ${DAY_SHORT[editor.day - 1]}`' @submit.prevent='saveEditor')
        .builder__dialog-head
          div
            .eyebrow {{ DAY_SHORT[editor.day - 1] }}, {{ shortDate(addDays(monday, editor.day - 1)) }}
            h2.card__title {{ MEAL_LABEL[editor.meal] }}
          button.btn.btn--ghost.btn--sm.builder__arrow(type='button' aria-label='Закрити' @click='editor = null')
            AppIcon(name='close' :size='18')
        label.field
          | Страва
          input(ref='titleInput' v-model='editor.title' type='text' list='builder-suggestions' placeholder='Напр.: вівсянка з ягодами' maxlength='120')
        datalist#builder-suggestions
          option(v-for='s in suggestions' :key='s' :value='s')
        label.field
          | Час
          input(v-model='editor.time' type='time')
        .builder__dialog-actions
          button.btn.btn--primary(type='submit' :disabled='busy') Зберегти
          button.btn.btn--ghost(v-if='editor.id' type='button' :disabled='busy' @click='removeFromEditor') Видалити
          button.btn.btn--ghost(v-else type='button' @click='editor = null') Скасувати
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.builder {
  &__state {
    display: inline-flex;
    align-items: center;
    padding: 6px 14px;
    border-radius: $pill;
    background: $warn-bg;
    color: $text-warn;
    font-size: 14px;
    font-weight: 700;

    &.is-live {
      background: $bg-active;
      color: $text-active;
    }
  }

  &__toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 16px;
    padding: 18px;
  }

  &__client {
    flex: 1 1 240px;
  }

  &__period {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__label {
    color: $text-nav;
    font-size: 14px;
  }

  &__week {
    display: flex;
    align-items: center;
    gap: 8px;

    b {
      min-width: 170px;
      text-align: center;
    }
  }

  &__arrow {
    width: 38px;
    padding: 0;
  }

  &__hint {
    margin-bottom: 14px;
    color: $text-muted;
    font-size: 14px;
  }

  &__scroll {
    overflow-x: auto;
  }

  &__grid {
    display: grid;
    grid-template-columns: 84px repeat(7, minmax(116px, 1fr));
    gap: 8px;
    min-width: 920px;
  }

  &__day {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px;
    border-radius: 12px;
    color: $text-muted;
    font-size: 13px;

    b {
      color: $text;
      font-size: 15px;
    }

    &.is-today {
      background: $bg-active;

      b {
        color: $green-link;
      }
    }
  }

  &__type {
    padding-top: 10px;
    color: $green-link;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;

    &--muted {
      color: $text-muted;
      text-transform: none;
    }
  }

  &__cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 64px;
    padding: 10px;
    border: 2px solid transparent;
    border-radius: 12px;
    background: $bg-soft;
    color: $text;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease;

    &:hover,
    &.is-editing {
      border-color: $accent;
    }

    &.is-empty {
      align-items: center;
      justify-content: center;
      border: 2px dashed $line-green;
      background: $bg;
      color: $green-link;

      &:hover {
        border-color: $accent;
      }
    }
  }

  &__time {
    color: $text-faint;
    font-size: 12px;
    font-weight: 700;
  }

  &__total {
    padding: 8px 10px;
    border-radius: 12px;
    background: $bg-active;
    color: $text-active;
    font-size: 13px;

    &.is-warn {
      background: $warn-bg;
      color: $text-warn;
    }
  }

  &__overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(20, 38, 27, 0.35);

    @media (max-width: $bp-md) {
      align-items: flex-end;
      padding: 0;
    }
  }

  &__dialog {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    max-width: 440px;
    padding: 22px;
    border-radius: $radius-card;
    background: $bg;

    @media (max-width: $bp-md) {
      max-width: none;
      padding-bottom: calc(22px + env(safe-area-inset-bottom));
      border-radius: $radius-card $radius-card 0 0;
    }
  }

  &__dialog-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  &__dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.builder-dialog-enter-active,
.builder-dialog-leave-active {
  transition: opacity 0.15s ease;
}

.builder-dialog-enter-from,
.builder-dialog-leave-to {
  opacity: 0;
}
</style>
