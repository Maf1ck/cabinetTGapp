<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DiaryEntryModal from '@/components/DiaryEntryModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import { listClients, listDiary, type ClientRow, type DiaryItem } from '@/api/nutri'
import { addDays, isoDate, longDate, timeOf } from '@/lib/dates'
import { MEAL_LABEL } from '@/lib/meals'
import { shortName } from '@/lib/clients'

const PERIODS = [
  { days: 7, label: '7 днів' },
  { days: 30, label: '30 днів' },
  { days: 90, label: '3 місяці' },
] as const

const route = useRoute()
const router = useRouter()

const clients = ref<ClientRow[]>([])
const entries = ref<DiaryItem[]>([])
const loading = ref(true)
const loadError = ref(false)

// фільтри живуть в адресі: /n/diaries?client=…&unseen=1 — можна дати посилання з картки клієнта
const clientId = ref<string>(typeof route.query.client === 'string' ? route.query.client : '')
const unseenOnly = ref(route.query.unseen === '1')
const period = ref<number>(30)

const opened = ref<number | null>(null)
const openedEntry = computed(() => (opened.value === null ? null : (entries.value[opened.value] ?? null)))

const joined = computed(() => clients.value.filter((c) => c.user_id))
const unseenCount = computed(() => entries.value.filter((e) => !e.seen_by_nutri).length)

/** Записи, згруповані за днями: «Середа, 4 листопада» → записи */
const days = computed(() => {
  const map = new Map<string, { label: string; list: { e: DiaryItem; i: number }[] }>()
  entries.value.forEach((e, i) => {
    const d = new Date(e.taken_at)
    const key = isoDate(d)
    const g = map.get(key) ?? { label: longDate(d), list: [] }
    g.list.push({ e, i })
    map.set(key, g)
  })
  return [...map.entries()].map(([key, g]) => ({ key, ...g }))
})

async function load() {
  loading.value = true
  loadError.value = false
  opened.value = null
  try {
    entries.value = await listDiary({
      clientId: clientId.value || null,
      unseenOnly: unseenOnly.value,
      since: addDays(new Date(), -period.value),
      limit: 120,
    })
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function step(d: number) {
  if (opened.value === null) return
  opened.value = Math.min(entries.value.length - 1, Math.max(0, opened.value + d))
}

function reviewed(entry: DiaryItem) {
  const i = entries.value.findIndex((e) => e.id === entry.id)
  if (unseenOnly.value) {
    entries.value = entries.value.filter((e) => e.id !== entry.id)
    opened.value = entries.value.length ? Math.min(i, entries.value.length - 1) : null
    return
  }
  const e = entries.value[i]
  if (e) e.seen_by_nutri = true
  // наступний непереглянутий після цього, інакше — закрити
  const next = entries.value.findIndex((x, j) => j > i && !x.seen_by_nutri)
  opened.value = next >= 0 ? next : null
}

watch([clientId, unseenOnly, period], () => {
  router.replace({
    query: { ...(clientId.value ? { client: clientId.value } : {}), ...(unseenOnly.value ? { unseen: '1' } : {}) },
  })
  load()
})

onMounted(async () => {
  load()
  try {
    clients.value = await listClients()
  } catch {
    // фільтр за клієнтом просто буде порожній
  }
})
</script>

<template lang="pug">
main.page.diaries
  .page-head
    div
      .page-head__sub Що клієнти їли і як почувалися
      h1.page-head__title Щоденники

  section.card.diaries__filters
    label.diaries__select
      span.sr-only Клієнт
      select(v-model='clientId')
        option(value='') Усі клієнти
        option(v-for='c in joined' :key='c.id' :value='c.id') {{ c.full_name }}
    .diaries__chips(role='group' aria-label='Період')
      button(
        v-for='p in PERIODS'
        :key='p.days'
        type='button'
        :class='{ "is-on": period === p.days }'
        :aria-pressed='period === p.days'
        @click='period = p.days'
      ) {{ p.label }}
    label.diaries__toggle
      input(v-model='unseenOnly' type='checkbox')
      | Лише непереглянуті
    span.chip(v-if='unseenCount && !unseenOnly') {{ unseenCount }} непереглянутих

  p.empty(v-if='loading') Завантажуємо записи…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити записи.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз
  p.empty(v-else-if='!entries.length') {{ unseenOnly ? 'Усе переглянуто 🌿' : 'За цей період записів немає.' }}

  template(v-else)
    section.diaries__day(v-for='d in days' :key='d.key')
      h2.diaries__date {{ d.label }}
      .diaries__grid
        button.diaries__entry(
          v-for='{ e, i } in d.list'
          :key='e.id'
          type='button'
          :class='{ "is-new": !e.seen_by_nutri }'
          :aria-label='`Відкрити запис: ${e.client ? e.client.full_name : "клієнт"}, ${e.meal ? MEAL_LABEL[e.meal] : "запис"}`'
          @click='opened = i'
        )
          .diaries__media
            img(v-if='e.photoUrl' :src='e.photoUrl' alt='' loading='lazy')
            p.diaries__text(v-else) {{ e.note || 'Без фото й нотатки' }}
            span.diaries__badge(v-if='!e.seen_by_nutri') нове
            span.diaries__badge.diaries__badge--done(v-else-if='e.comments')
              AppIcon(name='chat' :size='12')
              | {{ e.comments }}
          span.diaries__cap
            b {{ e.client ? shortName(e.client.full_name) : 'Клієнт' }}
            span {{ e.meal ? MEAL_LABEL[e.meal] : 'Запис' }} · {{ timeOf(new Date(e.taken_at)) }}
            small(v-if='e.photoUrl && e.note') {{ e.note }}
    p.diaries__more(v-if='entries.length >= 120') Показано останні 120 записів — звузьте період або оберіть клієнта.

  DiaryEntryModal(
    v-if='openedEntry && opened !== null'
    :entry='openedEntry'
    :index='opened'
    :total='entries.length'
    @close='opened = null'
    @prev='step(-1)'
    @next='step(1)'
    @reviewed='reviewed'
  )
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.diaries {
  &__filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  &__select select {
    min-height: 42px;
    padding: 8px 36px 8px 14px;
    border: 1px solid $line-green;
    border-radius: $pill;
    background: $bg-app;
    font: inherit;
    font-size: 14px;
  }

  &__chips {
    display: flex;
    gap: 6px;

    button {
      min-height: 36px;
      padding: 6px 14px;
      border: 1px solid $line-green;
      border-radius: $pill;
      background: $bg;
      color: $text;
      font: inherit;
      font-size: 14px;
      cursor: pointer;

      &.is-on {
        border-color: $accent;
        background: $bg-selected;
        color: $text-active;
        font-weight: 600;
      }
    }
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

  &__day {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  &__date {
    margin: 0;
    font-family: $font-body;
    font-size: 14px;
    font-weight: 700;
    color: $text-muted;

    &::first-letter {
      text-transform: uppercase;
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }

  &__entry {
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
    border: 1px solid $line;
    border-radius: 16px;
    background: $bg;
    color: $text;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s,
      transform 0.15s;

    &:hover,
    &:focus-visible {
      border-color: $accent;
      box-shadow: 0 6px 18px rgba(20, 38, 27, 0.12);
      transform: translateY(-2px);
    }

    &.is-new {
      border-color: $line-dashed;
    }
  }

  &__media {
    position: relative;
    height: 140px;
    background: $bg-soft;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__text {
    display: -webkit-box;
    margin: 0;
    padding: 14px;
    overflow: hidden;
    color: $text-nav;
    font-size: 14px;
    font-style: italic;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
  }

  &__badge {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 9px;
    border-radius: $pill;
    background: $accent;
    color: #fff;
    font-size: 12px;
    font-weight: 700;

    &--done {
      background: rgba(255, 255, 255, 0.92);
      color: $text-muted;
    }
  }

  &__cap {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    font-size: 14px;

    span {
      color: $text-muted;
    }

    small {
      overflow: hidden;
      color: $text-faint;
      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &__more {
    color: $text-faint;
    font-size: 13px;
  }
}
</style>
