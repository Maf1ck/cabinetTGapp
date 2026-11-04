<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import {
  getCalendar,
  listClients,
  saveAppointment,
  setAppointmentStatus,
  type CalendarItem,
  type ClientRow,
} from '@/api/nutri'
import { addDays, DAY_SHORT, isoDate, plural, shortDate, timeOf, weekday, weekStart } from '@/lib/dates'
import { shortName } from '@/lib/clients'

// Види зустрічей і тривалість за замовчуванням (як у дизайні)
const KINDS = [
  { kind: 'Перша консультація', min: 90, tone: 'first' },
  { kind: 'Супровід', min: 45, tone: 'support' },
  { kind: 'Повторна консультація', min: 45, tone: 'support' },
  { kind: 'Розбір аналізів', min: 60, tone: 'labs' },
] as const
const DURATIONS = [30, 45, 60, 90, 120]
const START_HOUR = 8
const END_HOUR = 21
const SLOT_MIN = 30
const SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MIN

const now = new Date()
const monday = ref(weekStart(now))
const items = ref<CalendarItem[]>([])
const clients = ref<ClientRow[]>([])
const loading = ref(true)
const error = ref('')
const busy = ref(false)

interface Draft {
  id?: string
  client_id: string
  date: string
  time: string
  kind: string
  duration_min: number
  zoom_url: string
  note: string
  status?: CalendarItem['status']
}
const draft = ref<Draft | null>(null)
const firstField = ref<HTMLSelectElement | null>(null)

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday.value, i)
    return { day: i + 1, date, today: isoDate(date) === isoDate(now) }
  }),
)
const range = computed(() => `${shortDate(monday.value)} — ${shortDate(addDays(monday.value, 6))}`)
const activeClients = computed(() => clients.value.filter((c) => c.active))
const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
const upcoming = computed(() =>
  items.value.filter((a) => a.status === 'planned' && new Date(a.starts_at).getTime() > Date.now() - 60 * 60_000).slice(0, 5),
)
const planned = computed(() => items.value.filter((a) => a.status !== 'cancelled').length)

const toneOf = (kind: string) => KINDS.find((k) => k.kind === kind)?.tone ?? 'other'

// Позиція на сітці: рядок 1 — заголовки днів, далі слоти по 30 хв
function place(a: CalendarItem) {
  const d = new Date(a.starts_at)
  const fromStart = (d.getHours() - START_HOUR) * 60 + d.getMinutes()
  const row = Math.min(SLOTS - 1, Math.max(0, Math.floor(fromStart / SLOT_MIN)))
  const span = Math.max(1, Math.min(SLOTS - row, Math.ceil(a.duration_min / SLOT_MIN)))
  return { gridColumn: weekday(d) + 1, gridRow: `${row + 2} / span ${span}` }
}

const isNow = (a: CalendarItem) => {
  const s = new Date(a.starts_at).getTime()
  return Date.now() >= s && Date.now() <= s + a.duration_min * 60_000
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [cal, cl] = await Promise.all([
      getCalendar(monday.value, addDays(monday.value, 7)),
      clients.value.length ? Promise.resolve(clients.value) : listClients(),
    ])
    items.value = cal
    clients.value = cl
  } catch {
    error.value = 'Не вдалося завантажити календар.'
  } finally {
    loading.value = false
  }
}

function openNew(date = new Date(), hour?: number, minute = 0) {
  const d = new Date(date)
  if (hour === undefined) {
    // найближча ціла година в робочих межах
    hour = Math.min(END_HOUR - 1, Math.max(START_HOUR, now.getHours() + 1))
  }
  d.setHours(hour, minute, 0, 0)
  draft.value = {
    client_id: activeClients.value[0]?.id ?? '',
    date: isoDate(d),
    time: timeOf(d),
    kind: KINDS[1].kind,
    duration_min: KINDS[1].min,
    zoom_url: '',
    note: '',
  }
  nextTick(() => firstField.value?.focus())
}

function openSlot(day: number, slot: number) {
  const minutes = START_HOUR * 60 + slot * SLOT_MIN
  openNew(addDays(monday.value, day - 1), Math.floor(minutes / 60), minutes % 60)
}

function openExisting(a: CalendarItem) {
  const d = new Date(a.starts_at)
  draft.value = {
    id: a.id,
    client_id: a.client?.id ?? '',
    date: isoDate(d),
    time: timeOf(d),
    kind: a.kind,
    duration_min: a.duration_min,
    zoom_url: a.zoom_url ?? '',
    note: a.note ?? '',
    status: a.status,
  }
  nextTick(() => firstField.value?.focus())
}

function pickKind(kind: string) {
  if (!draft.value) return
  draft.value.kind = kind
  // тривалість підлаштовуємо лише для нової зустрічі
  if (!draft.value.id) draft.value.duration_min = KINDS.find((k) => k.kind === kind)?.min ?? 45
}

// Накладки з іншими зустрічами того ж дня
const overlap = computed(() => {
  const d = draft.value
  if (!d?.date || !d.time) return null
  const start = new Date(`${d.date}T${d.time}`).getTime()
  const end = start + d.duration_min * 60_000
  return items.value.find((a) => {
    if (a.id === d.id || a.status === 'cancelled') return false
    const s = new Date(a.starts_at).getTime()
    return s < end && s + a.duration_min * 60_000 > start
  })
})

async function save() {
  const d = draft.value
  if (!d) return
  if (!d.client_id) {
    error.value = 'Оберіть клієнта.'
    return
  }
  const url = d.zoom_url.trim()
  if (url && !url.startsWith('https://')) {
    error.value = 'Посилання на зустріч має починатися з https://'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const saved = await saveAppointment(
      {
        client_id: d.client_id,
        starts_at: new Date(`${d.date}T${d.time}`).toISOString(),
        duration_min: d.duration_min,
        kind: d.kind,
        zoom_url: url || null,
        note: d.note.trim() || null,
      },
      d.id,
    )
    const inWeek = new Date(saved.starts_at) >= monday.value && new Date(saved.starts_at) < addDays(monday.value, 7)
    items.value = [...items.value.filter((a) => a.id !== saved.id), ...(inWeek ? [saved] : [])].sort((a, b) =>
      a.starts_at.localeCompare(b.starts_at),
    )
    draft.value = null
  } catch {
    error.value = 'Не вдалося зберегти зустріч.'
  } finally {
    busy.value = false
  }
}

async function setStatus(status: CalendarItem['status']) {
  const d = draft.value
  if (!d?.id) return
  if (status === 'cancelled' && !window.confirm('Скасувати цю зустріч?')) return
  busy.value = true
  try {
    await setAppointmentStatus(d.id, status)
    items.value =
      status === 'cancelled'
        ? items.value.filter((a) => a.id !== d.id)
        : items.value.map((a) => (a.id === d.id ? { ...a, status } : a))
    draft.value = null
  } catch {
    error.value = 'Не вдалося змінити статус.'
  } finally {
    busy.value = false
  }
}

const shiftWeek = (delta: number) => (monday.value = addDays(monday.value, delta * 7))
const goThisWeek = () => (monday.value = weekStart(now))

watch(monday, load)
onMounted(load)
</script>

<template lang="pug">
main.page.calendar
  .page-head
    div
      .page-head__sub {{ range }} · {{ planned }} {{ plural(planned, 'зустріч', 'зустрічі', 'зустрічей') }}
      h1.page-head__title Календар
    .page-head__actions
      .calendar__week
        button.btn.btn--ghost.btn--sm.calendar__arrow(type='button' aria-label='Попередній тиждень' @click='shiftWeek(-1)')
          AppIcon(name='chevronLeft' :size='18')
        button.btn.btn--ghost.btn--sm(type='button' @click='goThisWeek') Сьогодні
        button.btn.btn--ghost.btn--sm.calendar__arrow(type='button' aria-label='Наступний тиждень' @click='shiftWeek(1)')
          AppIcon(name='chevronRight' :size='18')
      button.btn.btn--primary(type='button' :disabled='!activeClients.length' @click='openNew()') + Консультація

  p.notice(v-if='error && !draft' role='alert') {{ error }}
  p.notice(v-if='!loading && !activeClients.length') Щоб планувати зустрічі, спершу додайте клієнта в розділі «Клієнти».

  .calendar__layout
    section.card.calendar__board
      .calendar__legend
        span(v-for='k in KINDS.filter((k, i) => i !== 2)' :key='k.kind')
          i(:class='`is-${k.tone}`')
          | {{ k.kind }}
      p.empty(v-if='loading') Завантажуємо…
      .calendar__scroll(v-else)
        .calendar__grid(:style='{ gridTemplateRows: `48px repeat(${SLOTS}, 26px)` }')
          .calendar__corner
          .calendar__day(v-for='d in weekDays' :key='d.day' :style='{ gridColumn: d.day + 1 }' :class='{ "is-today": d.today }')
            span {{ DAY_SHORT[d.day - 1] }}
            b {{ d.date.getDate() }}{{ d.today ? ' · сьогодні' : '' }}
          .calendar__hour(v-for='(h, i) in hours' :key='h' :style='{ gridRow: `${i * 2 + 2} / span 2` }') {{ String(h).padStart(2, '0') }}:00
          //- порожні слоти: клік створює зустріч на цей час
          template(v-for='d in weekDays' :key='`slots-${d.day}`')
            button.calendar__slot(
              v-for='s in SLOTS'
              :key='s'
              type='button'
              tabindex='-1'
              aria-hidden='true'
              :class='{ "is-hour": s % 2 === 1 }'
              :style='{ gridColumn: d.day + 1, gridRow: s + 1 }'
              :disabled='!activeClients.length'
              @click='openSlot(d.day, s - 1)'
            )
          button.calendar__item(
            v-for='a in items'
            :key='a.id'
            type='button'
            :style='place(a)'
            :class='[`is-${toneOf(a.kind)}`, { "is-now": isNow(a), "is-done": a.status === "done" }]'
            @click='openExisting(a)'
          )
            b {{ a.client ? shortName(a.client.full_name) : 'Клієнт' }}
            span {{ timeOf(new Date(a.starts_at)) }} · {{ a.status === 'done' ? 'проведено' : a.kind }}

    aside.calendar__side
      section.card
        h2.card__title Найближчі
        p.empty(v-if='!upcoming.length') На цьому тижні зустрічей більше немає.
        button.calendar__next(v-for='a in upcoming' :key='a.id' type='button' @click='openExisting(a)')
          b {{ DAY_SHORT[weekday(new Date(a.starts_at)) - 1] }}, {{ timeOf(new Date(a.starts_at)) }}
          span {{ a.client ? shortName(a.client.full_name) : 'Клієнт' }} · {{ a.kind }}
      section.card
        h2.card__title Тривалість послуг
        .calendar__dur(v-for='k in KINDS' :key='k.kind')
          span {{ k.kind }}
          b {{ k.min }} хв

  //- форма зустрічі
  Transition(name='calendar-dialog')
    .calendar__overlay(v-if='draft' @click.self='draft = null' @keydown.esc='draft = null')
      form.calendar__dialog(role='dialog' aria-modal='true' :aria-label='draft.id ? "Зустріч" : "Нова консультація"' @submit.prevent='save')
        .calendar__dialog-head
          h2.card__title {{ draft.id ? 'Зустріч' : 'Нова консультація' }}
          button.btn.btn--ghost.btn--sm.calendar__arrow(type='button' aria-label='Закрити' @click='draft = null')
            AppIcon(name='close' :size='18')
        label.field
          | Клієнт
          select(ref='firstField' v-model='draft.client_id' required)
            option(v-for='c in activeClients' :key='c.id' :value='c.id') {{ c.full_name }}
        .calendar__row
          label.field
            | Дата
            input(v-model='draft.date' type='date' required)
          label.field
            | Час
            input(v-model='draft.time' type='time' step='300' required)
        .calendar__kinds(role='radiogroup' aria-label='Вид зустрічі')
          button(
            v-for='k in KINDS'
            :key='k.kind'
            type='button'
            role='radio'
            :aria-checked='draft.kind === k.kind'
            :class='{ "is-on": draft.kind === k.kind }'
            @click='pickKind(k.kind)'
          ) {{ k.kind }}
        label.field
          | Тривалість
          select(v-model.number='draft.duration_min')
            option(v-for='m in DURATIONS' :key='m' :value='m') {{ m }} хв
        label.field
          | Посилання на зустріч (Zoom, Meet)
          input(v-model='draft.zoom_url' type='url' inputmode='url' placeholder='https://…')
        label.field
          | Нотатка
          input(v-model='draft.note' type='text' maxlength='120' placeholder='Напр.: розбір аналізів, корекція меню')
        p.notice(v-if='overlap') Накладається з зустріччю: {{ overlap.client ? shortName(overlap.client.full_name) : 'клієнт' }}, {{ timeOf(new Date(overlap.starts_at)) }}.
        p.notice(v-if='error' role='alert') {{ error }}
        .calendar__dialog-actions
          button.btn.btn--primary(type='submit' :disabled='busy') Зберегти
          template(v-if='draft.id')
            button.btn.btn--soft(v-if='draft.status === "planned"' type='button' :disabled='busy' @click='setStatus("done")') Проведено
            button.btn.btn--ghost(type='button' :disabled='busy' @click='setStatus("cancelled")') Скасувати зустріч
</template>

<style lang="scss">
@use '@/scss/variables' as *;

$tone-first: #d6ecd9;
$tone-support: #dde9e4;
$tone-labs: #fbebc5;
$tone-other: $line-soft;

.calendar {
  &__week {
    display: flex;
    gap: 6px;
  }

  &__arrow {
    width: 38px;
    padding: 0;
  }

  &__layout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 22px;
  }

  &__board {
    flex: 999 1 560px;
    padding: 18px;
  }

  &__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin-bottom: 12px;
    color: $text-nav;
    font-size: 13px;

    span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    i {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }
  }

  .is-first {
    background: $tone-first;
  }

  .is-support {
    background: $tone-support;
  }

  .is-labs {
    background: $tone-labs;
  }

  .is-other {
    background: $tone-other;
  }

  &__scroll {
    overflow-x: auto;
  }

  &__grid {
    display: grid;
    grid-template-columns: 52px repeat(7, minmax(104px, 1fr));
    column-gap: 6px;
    min-width: 820px;
  }

  &__corner,
  &__day {
    grid-row: 1;
  }

  &__day {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: $text-muted;
    font-size: 13px;

    b {
      color: $text;
    }

    &.is-today b {
      color: $green-link;
    }
  }

  &__hour {
    grid-column: 1;
    padding-top: 2px;
    color: $text-faint;
    font-size: 12px;
  }

  &__slot {
    padding: 0;
    border: 0;
    border-top: 1px dashed transparent;
    background: none;
    cursor: pointer;

    &.is-hour {
      border-top: 1px solid $line-soft;
    }

    &:hover:not(:disabled) {
      border-radius: 6px;
      background: $bg-soft;
    }

    &:disabled {
      cursor: default;
    }
  }

  &__item {
    z-index: 1;
    display: flex;
    flex-direction: column;
    margin: 2px 0;
    padding: 4px 8px;
    overflow: hidden;
    border: 2px solid transparent;
    border-radius: 10px;
    color: $text;
    font: inherit;
    font-size: 13px;
    line-height: 1.3;
    text-align: left;
    cursor: pointer;

    span {
      overflow: hidden;
      color: $text-nav;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &:hover {
      border-color: $line-input;
    }

    &.is-now {
      border-color: $accent;
    }

    &.is-done {
      opacity: 0.55;
    }
  }

  &__side {
    display: flex;
    flex: 1 1 280px;
    flex-direction: column;
    gap: 16px;

    .card__title {
      margin-bottom: 10px;
    }
  }

  &__next {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 10px 12px;
    margin-bottom: 6px;
    border: 0;
    border-radius: $radius-item;
    background: $bg-soft;
    color: $text;
    font: inherit;
    text-align: left;
    cursor: pointer;

    span {
      color: $text-muted;
      font-size: 14px;
    }

    &:hover {
      background: $bg-active;
    }
  }

  &__dur {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid $line-soft;
    font-size: 14px;

    &:last-child {
      border-bottom: 0;
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
    gap: 12px;
    width: 100%;
    max-width: 480px;
    max-height: calc(100dvh - 32px);
    padding: 22px;
    overflow-y: auto;
    border-radius: $radius-card;
    background: $bg;

    @media (max-width: $bp-md) {
      max-width: none;
      max-height: 92dvh;
      padding-bottom: calc(22px + env(safe-area-inset-bottom));
      border-radius: $radius-card $radius-card 0 0;
    }
  }

  &__dialog-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  &__kinds {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    button {
      min-height: 40px;
      padding: 8px 12px;
      border: 1px solid $line-green;
      border-radius: $pill;
      background: $bg;
      color: $text;
      font: inherit;
      font-size: 14px;
      cursor: pointer;

      &.is-on {
        border-color: $accent;
        background: $bg-active;
        color: $text-active;
        font-weight: 700;
      }
    }
  }

  &__dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
}

.calendar-dialog-enter-active,
.calendar-dialog-leave-active {
  transition: opacity 0.15s ease;
}

.calendar-dialog-enter-from,
.calendar-dialog-leave-to {
  opacity: 0;
}
</style>
