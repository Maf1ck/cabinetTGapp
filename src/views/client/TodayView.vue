<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuth } from '@/stores/auth'
import AppIcon from '@/components/AppIcon.vue'
import HintCard from '@/components/HintCard.vue'
import MealReportModal from '@/components/MealReportModal.vue'
import {
  getClientCard,
  getDiaryDays,
  getHabitsWeek,
  getNextAppointment,
  getShopping,
  getWater,
  getWeekMenu,
  getWellbeing,
  setHabitDone,
  setMealEaten,
  setShoppingChecked,
  setWater,
  setWellbeing,
  type Appointment,
  type DiaryEntry,
  type ClientCard,
  type Habit,
  type Meal,
  type ShoppingItem,
  type Wellbeing,
} from '@/api/client'
import {
  addDays,
  appointmentLabel,
  DAY_SHORT,
  days,
  greeting,
  isoDate,
  longDate,
  streak,
  weekday,
  weekStart,
} from '@/lib/dates'
import { hhmm, MEAL_LABEL } from '@/lib/meals'
import { useSettle } from '@/lib/settle'

const GLASS_ML = 250
const WATER_GOAL = 8 // склянок = 2 л

const WELLBEING: { key: keyof Wellbeing; label: string }[] = [
  { key: 'energy', label: 'Енергія' },
  { key: 'sleep', label: 'Сон' },
  { key: 'digestion', label: 'Травлення' },
  { key: 'mood', label: 'Настрій' },
]

const TIPS = [
  'наповнюйте половину тарілки овочами — це простіше, ніж рахувати калорії.',
  'склянка води до їжі допомагає не переїдати.',
  'білок у кожному прийомі їжі — і ситість триває довше.',
  'їжте повільно: відчуття ситості приходить за 15–20 хвилин.',
  'плануйте перекус заздалегідь, щоб не перехоплювати солодке.',
]

const auth = useAuth()
const clientId = auth.account!.clientId!

const now = new Date()
const today = isoDate(now)
const todayWd = weekday(now)
const monday = weekStart(now)
const week = { start: isoDate(monday), end: isoDate(addDays(monday, 6)) }
const tip = TIPS[now.getDate() % TIPS.length]

const loading = ref(true)
const loadError = ref(false)
const saveError = ref(false)
const card = ref<ClientCard | null>(null)
const appointment = ref<Appointment | null>(null)
const water = ref(0)
const wellbeing = ref<Wellbeing>({ energy: null, sleep: null, digestion: null, mood: null })
const meals = ref<Meal[] | null>(null)
const shopping = ref<ShoppingItem[]>([])
// на головній — лише перші некуплені, решта на сторінці «Список покупок».
// Відмічене спершу закреслюється, а за мить плавно зникає — і на його місце виїжджає наступне.
const { parked, fresh, reset: resetShop, update: settleShop } = useSettle()
const shoppingShown = computed(() => shopping.value.filter((i) => !parked.value.has(i.id)).slice(0, 6))
const shoppingLeft = computed(() => shopping.value.filter((i) => !i.checked).length)
const habits = ref<Habit[]>([])
const diaryDays = ref<string[]>([])
const diaryStreak = computed(() => streak(diaryDays.value, now))
/** страва, про яку клієнт на супроводі зараз надсилає фото чи коментар */
const reporting = ref<Meal | null>(null)
const selectedDay = ref(todayWd)

const firstName = computed(() => auth.account?.firstName || card.value?.full_name.split(' ')[0] || '')
const dayButtons = computed(() =>
  [todayWd - 1, todayWd, todayWd + 1].filter((d) => d >= 1 && d <= 7),
)
const dayMeals = computed(() => (meals.value ?? []).filter((m) => m.day === selectedDay.value))
// «Зараз» — перший нез'їдений прийом їжі сьогодні
const currentMealId = computed(() =>
  selectedDay.value === todayWd ? dayMeals.value.find((m) => !m.eaten)?.id : undefined,
)
const litres = computed(() => ((water.value * GLASS_ML) / 1000).toLocaleString('uk-UA'))
const program = computed(() => {
  const c = card.value
  if (!c?.program_week || !c.program_weeks) return c?.program_title ?? ''
  return `${c.program_title ?? 'Супровід'} · тиждень ${c.program_week} з ${c.program_weeks}`
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const since = addDays(now, -60).toISOString()
    const [c, a, w, wb, m, s, h, d] = await Promise.all([
      getClientCard(clientId),
      getNextAppointment(clientId),
      getWater(clientId, today),
      getWellbeing(clientId, today),
      getWeekMenu(clientId, week.start),
      getShopping(clientId, week.start),
      getHabitsWeek(clientId, week.start, week.end),
      getDiaryDays(clientId, since),
    ])
    card.value = c
    appointment.value = a
    water.value = w
    wellbeing.value = wb
    meals.value = m
    shopping.value = s
    resetShop(s.filter((i) => i.checked).map((i) => i.id))
    habits.value = h
    diaryDays.value = d
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

// Оптимістично: одразу показуємо зміну, при помилці повертаємо як було
async function save(apply: () => void, revert: () => void, request: () => Promise<void>) {
  apply()
  saveError.value = false
  try {
    await request()
  } catch {
    revert()
    saveError.value = true
  }
}

function changeWater(delta: number) {
  const before = water.value
  const after = Math.min(30, Math.max(0, before + delta))
  if (after === before) return
  save(
    () => (water.value = after),
    () => (water.value = before),
    () => setWater(clientId, today, after),
  )
}

function rate(key: keyof Wellbeing, value: number) {
  const before = wellbeing.value[key]
  const after = before === value ? null : value
  save(
    () => (wellbeing.value[key] = after),
    () => (wellbeing.value[key] = before),
    () => setWellbeing(clientId, today, { [key]: after }),
  )
}

function toggleMeal(meal: Meal) {
  // на супроводі «зʼїдено» ставиться лише разом зі звітом (фото або коментар)
  if (!meal.eaten && card.value?.on_support) {
    reporting.value = meal
    return
  }
  const after = !meal.eaten
  save(
    () => (meal.eaten = after),
    () => (meal.eaten = !after),
    () => setMealEaten(clientId, meal.id, after),
  )
}

function onReported(entry: DiaryEntry) {
  if (reporting.value) reporting.value.eaten = true
  reporting.value = null
  diaryDays.value = [...diaryDays.value, isoDate(new Date(entry.taken_at))]
}

function toggleItem(item: ShoppingItem) {
  const after = !item.checked
  save(
    () => {
      item.checked = after
      settleShop(item.id, after)
    },
    () => {
      item.checked = !after
      settleShop(item.id, !after)
    },
    () => setShoppingChecked(item.id, after),
  )
}

function toggleHabit(habit: Habit) {
  const done = habit.doneDays.includes(today)
  const before = [...habit.doneDays]
  save(
    () => (habit.doneDays = done ? before.filter((d) => d !== today) : [...before, today]),
    () => (habit.doneDays = before),
    () => setHabitDone(habit.id, today, !done),
  )
}

onMounted(load)
</script>

<template lang="pug">
main.page.today
  .page-head
    div
      .page-head__sub {{ longDate(now) }}
      h1.page-head__title {{ greeting(now) }}{{ firstName ? `, ${firstName}` : '' }}!
    .today__streak(v-if='diaryStreak > 0')
      AppIcon(name='flame' :size='20')
      span #[b {{ days(diaryStreak) }}] поспіль заповнюєте щоденник

  p.notice(v-if='saveError' role='alert') Не вдалося зберегти зміну. Перевірте інтернет і спробуйте ще раз.

  template(v-if='loading')
    .today__cards
      .card.today__skeleton(v-for='i in 3' :key='i')
    .card.today__skeleton.today__skeleton--wide

  .card(v-else-if='loadError')
    p.empty
      | Не вдалося завантажити дані.
      |
      button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз

  template(v-else)
    HintCard(id='today' title='Як користуватися кабінетом')
      ul
        li(v-if='card?.on_support') Зʼїли страву з меню — натисніть «Відмітити зʼїденим» і надішліть фото тарілки (або коментар, якщо сфотографувати не вийшло). Анастасія бачить кожен звіт.
        li(v-else) Зʼїли страву з меню — натисніть «Відмітити зʼїденим». Анастасія бачить ці відмітки.
        li Сфотографуйте тарілку в #[RouterLink(to='/c/diary') Щоденнику] — там можна просто обрати страву з меню.
        li Додавайте склянки води й відмічайте самопочуття — це займає кілька секунд.
    .today__cards
      .card.card--dark.today__appt
        .eyebrow Наступна зустріч
        template(v-if='appointment')
          .today__appt-when {{ appointmentLabel(new Date(appointment.starts_at)) }}
          .today__appt-sub {{ appointment.kind }}{{ program ? ` · ${program}` : '' }}
          a.btn.btn--white.btn--sm(v-if='appointment.zoom_url' :href='appointment.zoom_url' target='_blank' rel='noopener') Підключитися
        template(v-else)
          .today__appt-when Ще не запланована
          .today__appt-sub Анастасія надішле час зустрічі в Telegram.

      .card.today__water
        .eyebrow Вода сьогодні
        .today__big {{ litres }} #[span з {{ (WATER_GOAL * GLASS_ML) / 1000 }} л]
        .today__glasses(role='img' :aria-label='`Випито склянок: ${water} з ${WATER_GOAL}`')
          span(v-for='i in WATER_GOAL' :key='i' :class='{ "is-on": i <= water }')
        .today__water-actions
          button.btn.btn--soft(type='button' @click='changeWater(1)') + склянка
          button.btn.btn--ghost.today__minus(type='button' :disabled='water === 0' aria-label='Мінус склянка' @click='changeWater(-1)')
            AppIcon(name='minus' :size='18')

      .card.today__feel
        .eyebrow Як ви почуваєтесь?
        .today__feel-row(v-for='w in WELLBEING' :key='w.key')
          span {{ w.label }}
          .today__dots(role='radiogroup' :aria-label='w.label')
            button(
              v-for='v in 5'
              :key='v'
              type='button'
              role='radio'
              :aria-checked='wellbeing[w.key] === v'
              :aria-label='`${w.label}: ${v} з 5`'
              :class='{ "is-on": (wellbeing[w.key] ?? 0) >= v }'
              @click='rate(w.key, v)'
            )

    section.card
      .card__head
        h2.card__title Меню на сьогодні
        .today__days(v-if='meals?.length')
          button.btn.btn--sm(
            v-for='d in dayButtons'
            :key='d'
            type='button'
            :class='d === selectedDay ? "btn--primary" : "btn--ghost"'
            :aria-pressed='d === selectedDay'
            @click='selectedDay = d'
          ) {{ DAY_SHORT[d - 1] }}
      p.empty(v-if='meals === null') Меню на цей тиждень ще готується. Анастасія опублікує його тут.
      p.empty(v-else-if='!dayMeals.length') На цей день страв немає.
      .today__meals(v-else)
        article.today__meal(v-for='m in dayMeals' :key='m.id' :class='{ "today__meal--now": m.id === currentMealId }')
          .today__meal-pic(v-if='m.photoUrl')
            img.today__meal-photo(:src='m.photoUrl' :alt='m.title' loading='lazy')
            small.today__credit(v-if='m.photoCredit') Фото: {{ m.photoCredit }}
          .photo-ph.today__meal-photo(v-else aria-hidden='true')
            AppIcon(name='leaf' :size='26')
          .today__meal-body
            .today__meal-type {{ MEAL_LABEL[m.meal] }}{{ m.at_time ? ` · ${hhmm(m.at_time)}` : '' }}{{ m.id === currentMealId ? ' · зараз' : '' }}
            b {{ m.title }}
            RouterLink.today__recipe(v-if='m.recipe_id' :to='`/c/recipes/${m.recipe_id}`')
              AppIcon(name='book' :size='14')
              | Як приготувати
            button.today__eaten(type='button' :class='{ "is-on": m.eaten }' :aria-pressed='m.eaten' @click='toggleMeal(m)')
              AppIcon(v-if='m.eaten' name='check' :size='16')
              | {{ m.eaten ? "З'їдено" : "Відмітити з'їденим" }}
      RouterLink.today__more(v-if='meals?.length' to='/c/menu') Меню на весь тиждень →

    .today__row
      section.card.today__shop
        .card__head
          h2.card__title Список покупок
          span.today__hint з меню на тиждень
        p.empty(v-if='!shopping.length') Список зʼявиться разом із меню.
        TransitionGroup.today__checks(tag='div' name='today-check')
          label.today__check(v-for='item in shoppingShown' :key='item.id' :class='{ "is-on": item.checked, "is-fresh": fresh.has(item.id) }')
            input(type='checkbox' :checked='item.checked' @change='toggleItem(item)')
            span: span {{ item.name }}{{ item.amount ? `, ${item.amount}` : '' }}
        p.today__all-done(v-if='shopping.length && !shoppingShown.length') Усе куплено 🎉
        RouterLink.today__more(v-if='shopping.length' to='/c/shop')
          | {{ shoppingLeft > shoppingShown.length ? `Увесь список (ще ${shoppingLeft - shoppingShown.length}) →` : 'Увесь список →' }}

      section.card.today__habits
        h2.card__title Звички тижня
        p.empty(v-if='!habits.length') Звички Анастасія додасть після консультації.
        .today__habit(v-for='h in habits' :key='h.id')
          .today__habit-head
            span {{ h.title }}
            b {{ h.doneDays.length }}/{{ h.target_per_week }}
          .today__bar
            span(:style='{ width: `${Math.min(100, (h.doneDays.length / h.target_per_week) * 100)}%` }')
          button.today__habit-btn(type='button' :class='{ "is-on": h.doneDays.includes(today) }' :aria-pressed='h.doneDays.includes(today)' @click='toggleHabit(h)')
            AppIcon(name='check' :size='14')
            | {{ h.doneDays.includes(today) ? 'Сьогодні виконано' : 'Відмітити за сьогодні' }}
        .tip #[b Порада дня:] {{ tip }}

  MealReportModal(
    v-if='reporting'
    :client-id='clientId'
    :meal='reporting'
    :week-monday='monday'
    @close='reporting = null'
    @done='onReported'
  )
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.today {
  &__streak {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 18px;
    border: 1px solid $line;
    border-radius: $pill;
    background: $bg;
    color: $accent;

    span {
      color: $text;
    }
  }

  &__cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 16px;
  }

  &__skeleton {
    min-height: 190px;
    background: linear-gradient(90deg, $bg 0%, $bg-soft 50%, $bg 100%);
    background-size: 200% 100%;
    animation: today-shimmer 1.4s ease-in-out infinite;

    &--wide {
      min-height: 280px;
    }
  }

  &__appt {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;

    .btn {
      margin-top: 6px;
    }
  }

  &__appt-when {
    font-family: $font-heading;
    font-size: 24px;
  }

  &__appt-sub {
    color: $text-on-dark;
  }

  &__water,
  &__feel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  &__big {
    font-family: $font-heading;
    font-size: 26px;

    span {
      color: $text-faint;
      font-size: 18px;
    }
  }

  &__glasses {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 5px;

    span {
      height: 28px;
      border-radius: 6px;
      background: $line;
      transition: background 0.2s ease;

      &.is-on {
        background: $accent;
      }
    }
  }

  &__water-actions {
    display: flex;
    gap: 8px;
  }

  &__minus {
    width: 44px;
    padding: 0;
  }

  &__feel-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  &__dots {
    display: flex;

    button {
      position: relative;
      width: 26px;
      height: 32px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;

      // видима крапка 14px, а зона натискання більша
      &::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: $line;
        transform: translate(-50%, -50%);
        transition: background 0.15s ease;
      }

      &.is-on::after {
        background: $accent;
      }

      &:focus-visible {
        outline: 2px solid $line-green;
        border-radius: 6px;
      }
    }
  }

  &__days {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  &__meals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
  }

  &__meal {
    overflow: hidden;
    border: 1px solid $line;
    border-radius: 18px;

    &--now {
      border: 2px solid $accent;
    }
  }

  &__meal-photo {
    width: 100%;
    vertical-align: top;
    height: 110px;
    object-fit: cover;
  }

  &__meal-pic {
    position: relative;
  }

  &__credit {
    position: absolute;
    bottom: 0;
    left: 0;
    max-width: 100%;
    padding: 2px 8px;
    border-top-right-radius: 8px;
    background: rgba(20, 38, 27, 0.55);
    color: #fff;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__meal-body {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 14px;
  }

  &__recipe {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: $green-link;
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  &__meal-type {
    color: $green-link;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  &__eaten,
  &__habit-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    margin-top: 6px;
    padding: 6px 12px;
    border: 1px solid $line-green;
    border-radius: $pill;
    background: $bg;
    color: $text-nav;
    font: inherit;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;

    &.is-on {
      border-color: $bg-active;
      background: $bg-active;
      color: $green-link;
    }
  }

  &__more {
    display: inline-block;
    margin-top: 14px;
    font-size: 14px;
    font-weight: 700;
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;

    > .card {
      flex: 1 1 320px;
    }
  }

  &__hint {
    color: $text-faint;
    font-size: 13px;
  }

  &__check {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 44px;
    border-bottom: 1px solid $line-soft;
    cursor: pointer;

    &:last-child {
      border-bottom: 0;
    }

    input {
      width: 20px;
      height: 20px;
      accent-color: $accent;
    }

    > span {
      transition: color 0.3s ease;

      > span {
        background: linear-gradient(currentColor, currentColor) no-repeat 0 55% / 0 2px;
        box-decoration-break: clone;
        transition: background-size 0.35s ease;
      }
    }

    &.is-on > span {
      color: $text-faint;

      > span {
        background-size: 100% 2px;
      }
    }

    &.is-fresh input {
      animation: today-pop 0.35s ease-out;
    }
  }

  &__checks {
    display: flex;
    flex-direction: column;
  }

  &__all-done {
    margin: 4px 0;
    color: $text-active;
    font-weight: 700;
    animation: today-pop 0.5s ease-out;
  }

  &__habits {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  &__habit-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
    font-size: 14px;
  }

  &__bar {
    height: 8px;
    border-radius: 4px;
    background: $line;

    span {
      display: block;
      height: 100%;
      border-radius: 4px;
      background: $accent;
      transition: width 0.3s ease;
    }
  }
}

// пункт списку: зникає вбік і згортається, наступний підʼїжджає знизу
.today-check-move {
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.today-check-enter-active,
.today-check-leave-active {
  overflow: hidden;
  transition:
    opacity 0.35s ease,
    transform 0.35s ease,
    max-height 0.35s ease,
    min-height 0.35s ease;
}

.today-check-enter-from,
.today-check-leave-to {
  max-height: 0;
  min-height: 0 !important;
  opacity: 0;
  transform: translateX(24px);
}

.today-check-enter-to,
.today-check-leave-from {
  max-height: 80px;
}

@keyframes today-pop {
  0% {
    transform: scale(0.6);
  }
  60% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes today-shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
