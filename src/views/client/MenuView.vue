<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import AppIcon from '@/components/AppIcon.vue'
import { getWeekMenu, setMealEaten, type Meal } from '@/api/client'
import { addDays, DAY_SHORT, isoDate, shortDate, weekday, weekStart } from '@/lib/dates'
import { hhmm, MEAL_LABEL, MEALS } from '@/lib/meals'

const auth = useAuth()
const clientId = auth.account!.clientId!

const now = new Date()
const thisMonday = weekStart(now)
const monday = ref(thisMonday)
const selectedDay = ref(weekday(now))

const loading = ref(true)
const loadError = ref(false)
const saveError = ref(false)
const meals = ref<Meal[] | null>(null)

const isThisWeek = computed(() => isoDate(monday.value) === isoDate(thisMonday))
const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday.value, i)
    return { day: i + 1, date, today: isoDate(date) === isoDate(now) }
  }),
)
const range = computed(() => `${shortDate(monday.value)} — ${shortDate(addDays(monday.value, 6))}`)
// Рядки таблиці: лише ті прийоми їжі, що є в меню
const rows = computed(() => MEALS.filter((t) => meals.value?.some((m) => m.meal === t)))
const cell = (day: number, meal: string) => meals.value?.find((m) => m.day === day && m.meal === meal)
const dayMeals = computed(() => (meals.value ?? []).filter((m) => m.day === selectedDay.value))

async function load() {
  loading.value = true
  loadError.value = false
  try {
    meals.value = await getWeekMenu(clientId, isoDate(monday.value))
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function setWeek(d: Date) {
  monday.value = d
  selectedDay.value = isoDate(d) === isoDate(thisMonday) ? weekday(now) : 1
}
const shiftWeek = (delta: number) => setWeek(addDays(monday.value, delta * 7))
const goThisWeek = () => setWeek(thisMonday)

// Шаблон pug у dev іде як чистий JS — без `!`/`as`, тому приймаємо й undefined
const cellTitle = (m: Meal | undefined) =>
  m?.eaten ? 'Зʼїдено — натисніть, щоб зняти відмітку' : 'Натисніть, щоб відмітити зʼїденим'

async function toggle(meal: Meal | undefined) {
  if (!meal) return
  meal.eaten = !meal.eaten
  saveError.value = false
  try {
    await setMealEaten(clientId, meal.id, meal.eaten)
  } catch {
    meal.eaten = !meal.eaten
    saveError.value = true
  }
}

watch(monday, load, { immediate: true })
</script>

<template lang="pug">
main.page.menu
  .page-head
    div
      .page-head__sub Складено нутриціологом · {{ range }}
      h1.page-head__title Моє меню на тиждень
    .page-head__actions
      .menu__week
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Попередній тиждень' @click='shiftWeek(-1)')
          AppIcon(name='chevronLeft' :size='18')
        button.btn.btn--sm(type='button' :class='isThisWeek ? "btn--soft" : "btn--ghost"' :disabled='isThisWeek' @click='goThisWeek') Цей тиждень
        button.btn.btn--ghost.btn--sm(type='button' aria-label='Наступний тиждень' @click='shiftWeek(1)')
          AppIcon(name='chevronRight' :size='18')
      RouterLink.btn.btn--ghost(to='/c/shop') Список покупок

  p.notice(v-if='saveError' role='alert') Не вдалося зберегти відмітку. Спробуйте ще раз.

  section.card
    p.empty(v-if='loading') Завантажуємо меню…
    p.empty(v-else-if='loadError')
      | Не вдалося завантажити меню.
      |
      button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз
    p.empty(v-else-if='meals === null') Меню на цей тиждень ще не опубліковане.
    p.empty(v-else-if='!meals.length') У меню цього тижня поки немає страв.

    template(v-else)
      //- широкий екран: таблиця тижня
      .menu__scroll
        .menu__grid(:style='{ gridTemplateRows: `auto repeat(${rows.length}, auto)` }')
          div
          .menu__day(v-for='d in weekDays' :key='d.day' :class='{ "menu__day--today": d.today }')
            | {{ DAY_SHORT[d.day - 1] }} {{ d.date.getDate() }}{{ d.today ? ' · сьогодні' : '' }}
          template(v-for='t in rows' :key='t')
            .menu__meal-type {{ MEAL_LABEL[t] }}
            template(v-for='d in weekDays' :key='`${t}-${d.day}`')
              .menu__slot(v-if='cell(d.day, t)')
                button.menu__cell(
                  type='button'
                  :class='{ "menu__cell--today": d.today, "is-eaten": cell(d.day, t)?.eaten }'
                  :aria-pressed='!!cell(d.day, t)?.eaten'
                  :title='cellTitle(cell(d.day, t))'
                  @click='toggle(cell(d.day, t))'
                )
                  span {{ cell(d.day, t)?.title }}
                  AppIcon(v-if='cell(d.day, t)?.eaten' name='check' :size='16')
                RouterLink.menu__recipe(v-if='cell(d.day, t)?.recipe_id' :to='`/c/recipes/${cell(d.day, t)?.recipe_id}`')
                  AppIcon(name='book' :size='14')
                  | Рецепт
              .menu__cell.menu__cell--empty(v-else) —

      //- телефон: день за днем
      .menu__mobile
        .menu__chips(role='tablist' aria-label='День тижня')
          button(
            v-for='d in weekDays'
            :key='d.day'
            type='button'
            role='tab'
            :aria-selected='d.day === selectedDay'
            :class='{ "is-on": d.day === selectedDay, "is-today": d.today }'
            @click='selectedDay = d.day'
          )
            span {{ DAY_SHORT[d.day - 1] }}
            b {{ d.date.getDate() }}
        p.empty(v-if='!dayMeals.length') На цей день страв немає.
        .menu__slot(v-for='m in dayMeals' :key='m.id')
          button.menu__item(type='button' :class='{ "is-eaten": m.eaten }' :aria-pressed='m.eaten' @click='toggle(m)')
            img.menu__thumb(v-if='m.photoUrl' :src='m.photoUrl' alt='' loading='lazy')
            span.menu__item-text
              span.menu__item-type {{ MEAL_LABEL[m.meal] }}{{ m.at_time ? ` · ${hhmm(m.at_time)}` : '' }}
              b {{ m.title }}
            span.menu__tick
              AppIcon(name='check' :size='16')
          RouterLink.menu__recipe(v-if='m.recipe_id' :to='`/c/recipes/${m.recipe_id}`')
            AppIcon(name='book' :size='14')
            | Рецепт: {{ m.title }}

  .menu__row
    section.card.menu__plate
      h2.card__title Правило тарілки
      .menu__plate-body
        .menu__plate-img(role='img' aria-label='Тарілка: половина овочі, чверть білок, чверть крупи')
        ul.menu__legend
          li #[i.is-veg] ½ овочі та зелень
          li #[i.is-protein] ¼ білок
          li #[i.is-carb] ¼ крупи, хліб, картопля
    section.card.menu__help
      h2.card__title Як користуватися
      p.menu__help-text Натисніть на страву, щоб відмітити її з'їденою, — Анастасія бачить, як вам вдається триматися плану.
      RouterLink.btn.btn--soft(to='/c/chat') Попросити замінити страву
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.menu {
  &__week {
    display: flex;
    gap: 6px;

    .btn--ghost:has(.icon) {
      width: 38px;
      padding: 0;
    }
  }

  &__scroll {
    overflow-x: auto;

    @media (max-width: $bp-md) {
      display: none;
    }
  }

  &__grid {
    display: grid;
    grid-template-columns: 96px repeat(7, minmax(120px, 1fr));
    gap: 8px;
    min-width: 960px;
  }

  &__day {
    padding: 8px;
    border-radius: 12px;
    color: $text-muted;
    font-weight: 700;
    text-align: center;

    &--today {
      background: $accent;
      color: #fff;
    }
  }

  &__meal-type {
    padding-top: 10px;
    color: $green-link;
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
  }

  &__cell {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 6px;
    padding: 10px;
    border: 2px solid transparent;
    border-radius: 12px;
    background: $bg-soft;
    color: $text;
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;

    &:hover {
      border-color: $line-green;
    }

    &--today {
      border-color: $accent;
      background: $bg-active;

      &:hover {
        border-color: $accent;
      }
    }

    &.is-eaten {
      color: $text-faint;

      .icon {
        color: $accent;
      }
    }

    &--empty {
      justify-content: center;
      color: $text-faint;
      cursor: default;

      &:hover {
        border-color: transparent;
      }
    }
  }

  &__slot {
    display: flex;
    flex-direction: column;
    gap: 4px;

    > .menu__cell,
    > .menu__item {
      flex: 1;
    }
  }

  &__recipe {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 4px;
    padding: 2px 4px;
    color: $green-link;
    font-size: 13px;
    font-weight: 700;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  &__mobile {
    display: none;
    flex-direction: column;
    gap: 10px;

    @media (max-width: $bp-md) {
      display: flex;
    }
  }

  &__chips {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
    margin-bottom: 4px;

    button {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 0;
      border: 1px solid $line-green;
      border-radius: 12px;
      background: $bg;
      color: $text-nav;
      font: inherit;
      font-size: 12px;
      cursor: pointer;

      b {
        font-size: 16px;
      }

      &.is-today {
        border-color: $accent;
      }

      &.is-on {
        border-color: $accent;
        background: $accent;
        color: #fff;
      }
    }
  }

  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 64px;
    padding: 12px 14px;
    border: 1px solid $line;
    border-radius: $radius-item;
    background: $bg-soft;
    color: $text;
    font: inherit;
    text-align: left;
    cursor: pointer;

    &.is-eaten b {
      color: $text-faint;
    }
  }

  &__item-text {
    display: flex;
    flex: 1;
    flex-direction: column;
  }

  &__thumb {
    flex: none;
    width: 52px;
    height: 52px;
    border-radius: 12px;
    object-fit: cover;
  }

  &__item-type {
    color: $green-link;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  &__tick {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 2px solid $line-input;
    border-radius: 50%;
    color: transparent;

    .is-eaten & {
      border-color: $accent;
      background: $accent;
      color: #fff;
    }
  }

  &__row {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;

    > .card {
      flex: 1 1 300px;
    }
  }

  &__plate,
  &__help {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 14px;
  }

  &__plate-body {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 18px;
  }

  &__plate-img {
    flex: none;
    width: 120px;
    height: 120px;
    border: 6px solid #fff;
    border-radius: 50%;
    background: conic-gradient(#3a8f5c 0 50%, #c98a4a 50% 75%, #e3c96b 75% 100%);
    box-shadow: 0 0 0 1px $line;
  }

  &__legend {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    font-size: 14px;
    list-style: none;

    li {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    i {
      width: 12px;
      height: 12px;
      border-radius: 3px;
    }

    .is-veg {
      background: #3a8f5c;
    }

    .is-protein {
      background: #c98a4a;
    }

    .is-carb {
      background: #e3c96b;
    }
  }

  &__help-text {
    color: $text-muted;
  }
}
</style>
