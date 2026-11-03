<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '@/stores/auth'
import {
  addDiaryComment,
  countUnseenDiary,
  diaryDaysByClient,
  getSchedule,
  listClients,
  listUnseenDiary,
  markDiarySeen,
  paidSumSince,
  type ClientRow,
  type DiaryItem,
  type ScheduleItem,
} from '@/api/nutri'
import { addDays, days, fromIso, longDate, streak, timeOf } from '@/lib/dates'
import { MEAL_LABEL } from '@/lib/meals'
import { programLabel, shortName } from '@/lib/clients'

const TEMPLATES = ['Чудова тарілка!', 'Додайте овочів — і буде ідеально.', 'Гарний баланс білка й клітковини.']

const auth = useAuth()
const now = new Date()
const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
const monthName = new Intl.DateTimeFormat('uk-UA', { month: 'long' }).format(now)

const loading = ref(true)
const loadError = ref(false)
const schedule = ref<ScheduleItem[]>([])
const clients = ref<ClientRow[]>([])
const unseen = ref<DiaryItem[]>([])
const unseenCount = ref(0)
const income = ref(0)
const diaryDays = ref(new Map<string, string[]>())
const search = ref('')

const selected = ref<DiaryItem | null>(null)
const comment = ref('')
const sending = ref(false)
const sendError = ref(false)

const active = computed(() => clients.value.filter((c) => c.active))
const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? active.value.filter((c) => c.full_name.toLowerCase().includes(q)) : active.value
})
const nowAppt = computed(() => {
  const t = Date.now()
  return schedule.value.find((a) => {
    const s = new Date(a.starts_at).getTime()
    return t >= s - 15 * 60_000 && t <= s + 60 * 60_000
  })?.id
})

function diaryStatus(c: ClientRow): { text: string; warn: boolean } {
  const list = diaryDays.value.get(c.id) ?? []
  if (!c.user_id) return { text: 'Не підключений', warn: false }
  if (!list.length) return { text: 'Немає записів', warn: true }
  const s = streak(list, now)
  if (s > 0) return { text: `${days(s)} поспіль`, warn: false }
  const gap = Math.round((dayStart.getTime() - fromIso(list[0]!).getTime()) / 86_400_000)
  return { text: `${days(gap)} без записів`, warn: gap >= 3 }
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [s, c, u, n, p, d] = await Promise.all([
      getSchedule(dayStart, addDays(dayStart, 1)),
      listClients(),
      listUnseenDiary(6),
      countUnseenDiary(),
      paidSumSince(monthStart),
      diaryDaysByClient(addDays(now, -60).toISOString()),
    ])
    schedule.value = s
    clients.value = c
    unseen.value = u
    unseenCount.value = n
    income.value = p
    diaryDays.value = d
    selected.value = u[0] ?? null
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function send(body = comment.value.trim()) {
  const entry = selected.value
  if (!entry || !body || !auth.account) return
  sending.value = true
  sendError.value = false
  try {
    await addDiaryComment(entry.id, auth.account.userId, body)
    await markDiarySeen(entry.id)
    unseen.value = unseen.value.filter((e) => e.id !== entry.id)
    unseenCount.value = Math.max(0, unseenCount.value - 1)
    selected.value = unseen.value[0] ?? null
    comment.value = ''
  } catch {
    sendError.value = true
  } finally {
    sending.value = false
  }
}

async function seen(entry: DiaryItem) {
  try {
    await markDiarySeen(entry.id)
    unseen.value = unseen.value.filter((e) => e.id !== entry.id)
    unseenCount.value = Math.max(0, unseenCount.value - 1)
    if (selected.value?.id === entry.id) selected.value = unseen.value[0] ?? null
  } catch {
    sendError.value = true
  }
}

onMounted(load)
</script>

<template lang="pug">
main.page.overview
  .page-head
    div
      .page-head__sub {{ longDate(now) }}
      h1.page-head__title Огляд дня
    .page-head__actions
      RouterLink.btn.btn--ghost(to='/n/builder') Створити меню
      RouterLink.btn.btn--primary(:to='{ path: "/n/clients", query: { new: "1" } }') + Новий клієнт

  p.empty(v-if='loading') Завантажуємо…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити дані.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз

  template(v-else)
    .overview__stats
      .card.overview__stat
        span Консультацій сьогодні
        b {{ schedule.length }}
      .card.overview__stat
        span Клієнтів на супроводі
        b {{ active.length }}
      .card.overview__stat
        span Нових записів у щоденниках
        b.is-accent {{ unseenCount }}
      .card.overview__stat
        span Дохід за {{ monthName }}
        b {{ income.toLocaleString('uk-UA') }} ₴

    .overview__row
      section.card.overview__schedule
        h2.card__title Розклад на сьогодні
        p.empty(v-if='!schedule.length') Сьогодні зустрічей немає.
        .overview__slot(v-for='a in schedule' :key='a.id' :class='{ "overview__slot--now": a.id === nowAppt }')
          b.overview__time {{ timeOf(new Date(a.starts_at)) }}
          div
            b {{ a.client ? shortName(a.client.full_name) : 'Клієнт' }}
            .overview__muted {{ a.kind }}{{ a.note ? ` · ${a.note}` : '' }}{{ a.id === nowAppt ? ' · зараз' : '' }}
            RouterLink.overview__link(v-if='a.client' :to='`/n/clients/${a.client.id}`') Картка клієнта

      section.card.overview__review
        .card__head
          h2.card__title Нові записи у щоденниках
          span.chip(v-if='unseenCount') {{ unseenCount }} непереглянутих
        p.empty(v-if='!unseen.length') Усі записи переглянуто 🌿
        template(v-else)
          .overview__photos
            button.overview__photo(
              v-for='e in unseen'
              :key='e.id'
              type='button'
              :class='{ "is-on": selected?.id === e.id }'
              :aria-pressed='selected?.id === e.id'
              @click='selected = e'
            )
              img(v-if='e.photoUrl' :src='e.photoUrl' :alt='`Фото: ${e.meal ? MEAL_LABEL[e.meal] : "прийом їжі"}`' loading='lazy')
              .photo-ph(v-else) {{ e.note ? 'Нотатка' : 'Фото' }}
              span.overview__photo-cap
                b {{ e.client ? shortName(e.client.full_name) : 'Клієнт' }}
                span {{ e.meal ? MEAL_LABEL[e.meal] : 'Запис' }} · {{ timeOf(new Date(e.taken_at)) }}
          template(v-if='selected')
            p.overview__note(v-if='selected.note') «{{ selected.note }}»
            label.field
              | Коментар для {{ selected.client ? shortName(selected.client.full_name) : 'клієнта' }}
              textarea(v-model='comment' rows='2' placeholder='Напишіть відгук на прийом їжі…')
            p.notice(v-if='sendError' role='alert') Не вдалося зберегти. Спробуйте ще раз.
            .overview__actions
              button.btn.btn--primary(type='button' :disabled='sending || !comment.trim()' @click='send()') Надіслати
              button.btn.btn--ghost(v-for='t in TEMPLATES' :key='t' type='button' :disabled='sending' @click='send(t)') «{{ t }}»
              button.btn.btn--soft(type='button' :disabled='sending' @click='seen(selected)') Переглянуто без коментаря

    section.card
      .card__head
        h2.card__title Клієнти на супроводі
        label.overview__search
          span.sr-only Пошук клієнта
          input(v-model='search' type='search' placeholder="Ім'я клієнта")
      p.empty(v-if='!active.length')
        | Клієнтів поки немає.
        |
        RouterLink(:to='{ path: "/n/clients", query: { new: "1" } }') Додати першого
      .overview__table-wrap(v-else)
        table.overview__table
          thead
            tr
              th Клієнт
              th Ціль
              th Програма
              th Щоденник
              th Дія
          tbody
            tr(v-for='c in shown' :key='c.id')
              td: b {{ shortName(c.full_name) }}
              td {{ c.goal || '—' }}
              td {{ programLabel(c) || '—' }}
              td(:class='{ "is-warn": diaryStatus(c).warn }') {{ diaryStatus(c).text }}
              td: RouterLink(:to='`/n/clients/${c.id}`') {{ c.user_id ? 'Картка' : 'Запросити' }}
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.overview {
  &__stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px;
  }

  &__stat {
    display: flex;
    flex-direction: column;
    padding: 18px;
    border-radius: 18px;

    span {
      color: $text-muted;
      font-size: 13px;
    }

    b {
      font-family: $font-heading;
      font-size: 30px;
      font-weight: 500;

      &.is-accent {
        color: $green-link;
      }
    }
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 22px;
  }

  &__schedule {
    flex: 1 1 300px;
  }

  &__review {
    display: flex;
    flex: 2 1 460px;
    flex-direction: column;
    gap: 14px;

    .card__head {
      margin-bottom: 0;
    }
  }

  &__schedule .card__title {
    margin-bottom: 8px;
  }

  &__slot {
    display: flex;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 1px solid $line-soft;

    &:last-child {
      border-bottom: 0;
    }

    &--now {
      margin: 4px -12px;
      padding: 12px;
      border-bottom: 0;
      border-radius: $radius-item;
      background: $bg-active;
    }
  }

  &__time {
    flex: none;
    width: 52px;
  }

  &__muted {
    color: $text-muted;
    font-size: 14px;
  }

  &__link {
    font-size: 14px;
    font-weight: 700;
  }

  &__photos {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
  }

  &__photo {
    overflow: hidden;
    padding: 0;
    border: 1px solid $line;
    border-radius: 16px;
    background: $bg;
    color: $text;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &.is-on {
      border: 2px solid $accent;
    }

    img,
    .photo-ph {
      display: flex;
      width: 100%;
      height: 100px;
      object-fit: cover;
    }
  }

  &__photo-cap {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    font-size: 14px;

    span {
      color: $text-muted;
    }
  }

  &__note {
    color: $text-nav;
    font-style: italic;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__search input {
    min-height: 44px;
    padding: 10px 14px;
    border: 1px solid $line-green;
    border-radius: $pill;
    background: $bg-app;
    font: inherit;
  }

  &__table-wrap {
    overflow-x: auto;
  }

  &__table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-size: 14px;

    th {
      padding: 10px 8px;
      border-bottom: 1px solid $line;
      color: $text-muted;
      font-weight: 600;
      text-align: left;
    }

    td {
      padding: 12px 8px;
      border-bottom: 1px solid $line-soft;
    }

    tr:last-child td {
      border-bottom: 0;
    }

    .is-warn {
      color: $text-warn;
      font-weight: 700;
    }
  }
}
</style>
