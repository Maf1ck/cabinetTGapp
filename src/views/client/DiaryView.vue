<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAuth } from '@/stores/auth'
import AppIcon from '@/components/AppIcon.vue'
import HintCard from '@/components/HintCard.vue'
import { addDiaryEntry, deleteDiaryEntry, getDiary, getWeekMenu, setMealEaten, type DiaryEntry, type Meal } from '@/api/client'
import { addDays, DAY_SHORT, days, fromIso, isoDate, streak, timeOf, weekday, weekStart } from '@/lib/dates'
import { dueMeals, hhmm, MEAL_LABEL, MEAL_TIME, MEALS, mealByTime, type MealType } from '@/lib/meals'
import { compressImage, MAX_UPLOAD_BYTES } from '@/lib/image'

const RANGE_DAYS = 14
const MOODS = ['Спокійно', 'Радісно', 'Поспіхом', 'Втома', 'Стрес']

const auth = useAuth()
const clientId = auth.account!.clientId!

const now = new Date()
const todayIso = isoDate(now)
const from = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -(RANGE_DAYS - 1))
const strip = Array.from({ length: RANGE_DAYS }, (_, i) => {
  const date = addDays(from, i)
  return { iso: isoDate(date), date }
})

const loading = ref(true)
const loadError = ref(false)
const entries = ref<DiaryEntry[]>([])
const selected = ref(todayIso)

// форма
const meal = ref<MealType>(mealByTime(now))
const note = ref('')
const hunger = ref<number | null>(null)
const fullness = ref<number | null>(null)
const mood = ref<string | null>(null)
const photo = ref<File | null>(null)
const preview = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const saving = ref(false)
const formError = ref('')

// ---- меню: що Анастасія запланувала на обраний день
/** week_start → страви опублікованого меню (null — меню на тиждень немає) */
const menus = ref(new Map<string, Meal[] | null>())
/** страва з меню, яку обрали для запису */
const fromMenu = ref<Meal | null>(null)

const plannedForDay = computed(() => {
  const date = fromIso(selected.value)
  const week = menus.value.get(isoDate(weekStart(date)))
  return (week ?? []).filter((m) => m.day === weekday(date))
})
/** на сьогодні — лише страви, чий час уже настав; за минулі дні — усі */
const menuChoices = computed(() => dueMeals(plannedForDay.value, fromIso(selected.value), new Date()))
const laterToday = computed(() => plannedForDay.value.length - menuChoices.value.length)
const loggedMeals = computed(() => new Set(dayEntries.value.map((e) => e.meal)))

function chooseFromMenu(m: Meal) {
  if (fromMenu.value?.id === m.id) return clearMenuChoice()
  fromMenu.value = m
  meal.value = m.meal
  note.value = m.title
}

function clearMenuChoice() {
  if (fromMenu.value && note.value === fromMenu.value.title) note.value = ''
  fromMenu.value = null
}

// змінили прийом їжі вручну — зв'язок зі стравою меню вже не той
function onMealChange() {
  if (fromMenu.value && fromMenu.value.meal !== meal.value) fromMenu.value = null
}

// інший день — інше меню
watch(selected, clearMenuChoice)

async function loadMenus() {
  const weeks = [...new Set(strip.map((d) => isoDate(weekStart(d.date))))]
  const loaded = await Promise.all(weeks.map((w) => getWeekMenu(clientId, w).catch(() => null)))
  menus.value = new Map(weeks.map((w, i) => [w, loaded[i] ?? null]))
}

const byDay = computed(() => {
  const map = new Map<string, DiaryEntry[]>()
  for (const e of entries.value) {
    const key = isoDate(new Date(e.taken_at))
    map.set(key, [...(map.get(key) ?? []), e])
  }
  return map
})
const dayEntries = computed(() => byDay.value.get(selected.value) ?? [])
const series = computed(() => streak(byDay.value.keys(), now))
const isToday = computed(() => selected.value === todayIso)
const canSave = computed(() => !saving.value && (photo.value || note.value.trim()))
// «Перекус» є двічі (до і після обіду), тож показуємо поруч звичайний час
const mealOptions = MEALS.map((m) => ({ value: m, label: `${MEAL_LABEL[m]} · ${MEAL_TIME[m]}` }))

async function load() {
  loading.value = true
  loadError.value = false
  try {
    const [diary] = await Promise.all([getDiary(clientId, from, addDays(now, 1)), loadMenus()])
    entries.value = diary
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function pickPhoto(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    formError.value = 'Оберіть фото.'
    return
  }
  if (file.size > MAX_UPLOAD_BYTES * 3) {
    formError.value = 'Фото завелике.'
    return
  }
  formError.value = ''
  photo.value = file
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = URL.createObjectURL(file)
}

function clearPhoto() {
  photo.value = null
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function resetForm() {
  clearPhoto()
  note.value = ''
  hunger.value = null
  fullness.value = null
  mood.value = null
  fromMenu.value = null
  meal.value = mealByTime(new Date())
}

// Запис за минулий день ставимо на звичайний час прийому їжі
function takenAt(): string {
  if (isToday.value) return new Date().toISOString()
  const [h, m] = MEAL_TIME[meal.value].split(':').map(Number)
  const d = fromIso(selected.value)
  d.setHours(h!, m!)
  return d.toISOString()
}

async function save() {
  if (!canSave.value) return
  saving.value = true
  formError.value = ''
  try {
    const blob = photo.value ? await compressImage(photo.value) : null
    if (blob && blob.size > MAX_UPLOAD_BYTES) throw new Error('too_big')
    const entry = await addDiaryEntry(
      clientId,
      {
        meal: meal.value,
        note: note.value.trim() || null,
        hunger: hunger.value,
        fullness: fullness.value,
        mood: mood.value,
        taken_at: takenAt(),
      },
      blob,
    )
    entries.value = [...entries.value, entry].sort((a, b) => a.taken_at.localeCompare(b.taken_at))
    // з'їли страву з меню — одразу відмічаємо її, Анастасія побачить це в меню
    const planned = fromMenu.value
    if (planned && !planned.eaten)
      setMealEaten(clientId, planned.id, true)
        .then(() => (planned.eaten = true))
        .catch(() => {})
    resetForm()
  } catch (e) {
    formError.value =
      e instanceof Error && e.message === 'too_big'
        ? 'Фото завелике навіть після стиснення. Спробуйте інше.'
        : 'Не вдалося зберегти запис. Перевірте інтернет і спробуйте ще раз.'
  } finally {
    saving.value = false
  }
}

async function remove(entry: DiaryEntry) {
  if (!window.confirm('Видалити цей запис зі щоденника?')) return
  try {
    await deleteDiaryEntry(entry)
    entries.value = entries.value.filter((e) => e.id !== entry.id)
  } catch {
    formError.value = 'Не вдалося видалити запис.'
  }
}

const scale = (v: number | null) => (v ? `${v}/5` : '—')

onMounted(load)
onBeforeUnmount(() => preview.value && URL.revokeObjectURL(preview.value))
</script>

<template lang="pug">
main.page.diary
  .page-head
    div
      .page-head__sub Без підрахунку калорій — лише фото, відчуття і звички
      h1.page-head__title Щоденник їжі
    .diary__streak(v-if='series > 0') #[b {{ days(series) }}] поспіль

  HintCard(id='diary' title='Як вести щоденник')
    ul
      li Оберіть страву з меню — вона сама відмітиться зʼїденою. Їли інше — просто опишіть.
      li Фото необовʼязкове, але так Анастасії легше підказати.
      li Голод, ситість і настрій важливіші за калорії: відмічайте, як почувались.
      li Забули записати? Оберіть потрібний день угорі.

  .diary__strip(role='tablist' aria-label='День')
    button(
      v-for='d in strip'
      :key='d.iso'
      type='button'
      role='tab'
      :aria-selected='d.iso === selected'
      :class='{ "is-on": d.iso === selected, "has-entries": byDay.has(d.iso) }'
      @click='selected = d.iso'
    )
      span {{ DAY_SHORT[weekday(d.date) - 1] }}
      b {{ d.date.getDate() }}

  .diary__layout
    section.diary__list
      p.empty(v-if='loading') Завантажуємо…
      p.empty(v-else-if='loadError')
        | Не вдалося завантажити щоденник.
        |
        button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз
      p.empty(v-else-if='!dayEntries.length') {{ isToday ? 'Сьогодні записів ще немає. Сфотографуйте першу тарілку 🌿' : 'Цього дня записів немає.' }}

      article.card.diary__entry(v-for='e in dayEntries' :key='e.id')
        a.diary__photo(v-if='e.photoUrl' :href='e.photoUrl' target='_blank' rel='noopener')
          img(:src='e.photoUrl' :alt='`Фото: ${e.meal ? MEAL_LABEL[e.meal] : "прийом їжі"}`' loading='lazy')
        .photo-ph.diary__photo(v-else) Без фото
        .diary__body
          .diary__meta
            span.diary__type {{ e.meal ? MEAL_LABEL[e.meal] : 'Запис' }} · {{ timeOf(new Date(e.taken_at)) }}
            button.diary__delete(type='button' aria-label='Видалити запис' @click='remove(e)')
              AppIcon(name='close' :size='16')
          b(v-if='e.note') {{ e.note }}
          .diary__feel(v-if='e.hunger || e.fullness || e.mood')
            span(v-if='e.hunger') Голод до: #[b {{ scale(e.hunger) }}]
            span(v-if='e.fullness') Ситість після: #[b {{ scale(e.fullness) }}]
            span(v-if='e.mood') Настрій: #[b {{ e.mood.toLowerCase() }}]
          .tip(v-for='c in e.comments' :key='c.id') #[b Анастасія:] {{ c.body }}
          .diary__wait(v-if='!e.comments.length') {{ e.seen_by_nutri ? 'Переглянуто нутриціологом' : 'Очікує коментаря нутриціолога' }}

    form.card.diary__form(@submit.prevent='save')
      h2.card__title Новий запис
      p.diary__for(v-if='!isToday') За {{ fromIso(selected).getDate() }} число
      .diary__menu(v-if='menuChoices.length')
        span.diary__menu-title Що з меню ви їли?
        .diary__menu-list
          button.diary__menu-item(
            v-for='m in menuChoices'
            :key='m.id'
            type='button'
            :class='{ "is-on": fromMenu?.id === m.id }'
            :aria-pressed='fromMenu?.id === m.id'
            @click='chooseFromMenu(m)'
          )
            img(v-if='m.photoUrl' :src='m.photoUrl' alt='' loading='lazy' :title='m.photoCredit ? `Фото: ${m.photoCredit}` : undefined')
            span.diary__menu-ph(v-else aria-hidden='true'): AppIcon(name='leaf' :size='18')
            span.diary__menu-text
              small {{ MEAL_LABEL[m.meal] }}{{ m.at_time ? ` · ${hhmm(m.at_time)}` : '' }}
              b {{ m.title }}
            span.diary__menu-done(v-if='m.eaten || loggedMeals.has(m.meal)') {{ m.eaten ? 'зʼїдено' : 'є запис' }}
        p.diary__hint.diary__hint--left
          template(v-if='laterToday') Ще {{ laterToday }} {{ laterToday === 1 ? 'страва зʼявиться' : 'страви зʼявляться' }} тут ближче до свого часу.
          |
          | Їли щось інше — просто опишіть нижче.
      p.diary__hint.diary__hint--left(v-else-if='plannedForDay.length && isToday') Страви з меню зʼявляться тут, щойно настане їхній час.

      label.field
        | Прийом їжі
        select(v-model='meal' @change='onMealChange')
          option(v-for='o in mealOptions' :key='o.value' :value='o.value') {{ o.label }}

      input.sr-only(ref='fileInput' type='file' accept='image/*' capture='environment' @change='pickPhoto')
      .diary__preview(v-if='preview')
        img(:src='preview' alt='Обране фото')
        button.btn.btn--white.btn--sm(type='button' @click='clearPhoto') Інше фото
      button.diary__shot(v-else type='button' @click='fileInput?.click()')
        AppIcon(name='camera' :size='26')
        | Сфотографувати тарілку

      label.field
        | Що їли
        input(v-model='note' type='text' maxlength='200' placeholder='Напр.: тофу з овочами вок')

      .diary__scale
        span Наскільки були голодні?
        .diary__nums
          button(v-for='v in 5' :key='v' type='button' :class='{ "is-on": hunger === v }' :aria-pressed='hunger === v' @click='hunger = hunger === v ? null : v') {{ v }}
      .diary__scale
        span Ситість після
        .diary__nums
          button(v-for='v in 5' :key='v' type='button' :class='{ "is-on": fullness === v }' :aria-pressed='fullness === v' @click='fullness = fullness === v ? null : v') {{ v }}
      .diary__scale
        span Настрій під час їжі
        .diary__moods
          button(v-for='m in MOODS' :key='m' type='button' :class='{ "is-on": mood === m }' :aria-pressed='mood === m' @click='mood = mood === m ? null : m') {{ m }}

      p.notice(v-if='formError' role='alert') {{ formError }}
      button.btn.btn--primary(type='submit' :disabled='!canSave') {{ saving ? 'Зберігаємо…' : 'Зберегти запис' }}
      p.diary__hint(v-if='!photo && !note.trim()') Додайте фото або напишіть, що їли.
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.diary {
  &__streak {
    padding: 10px 18px;
    border: 1px solid $line;
    border-radius: $pill;
    background: $bg;
  }

  &__strip {
    display: flex;
    gap: 8px;
    padding-bottom: 4px;
    overflow-x: auto;
    scrollbar-width: thin;

    button {
      position: relative;
      display: flex;
      flex: none;
      flex-direction: column;
      align-items: center;
      min-width: 54px;
      min-height: 60px;
      padding: 8px 12px;
      border: 1px solid $line;
      border-radius: 16px;
      background: $bg;
      color: $text;
      font: inherit;
      cursor: pointer;

      span {
        color: $text-faint;
        font-size: 12px;
      }

      // крапка: цього дня є записи
      &.has-entries::after {
        content: '';
        position: absolute;
        bottom: 6px;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: $accent;
      }

      &.is-on {
        border-color: $accent;
        background: $accent;
        color: #fff;

        span {
          color: #fff;
        }

        &::after {
          background: #fff;
        }
      }
    }
  }

  &__layout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 22px;
  }

  &__list {
    display: flex;
    flex: 999 1 460px;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }

  &__entry {
    display: flex;
    flex-wrap: wrap;
    gap: 18px;
    padding: 18px;
  }

  &__photo {
    display: flex;
    flex: none;
    width: 150px;
    height: 130px;
    overflow: hidden;
    border-radius: 16px;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    @media (max-width: $bp-md) {
      width: 100%;
      height: 200px;
    }
  }

  &__body {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  &__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  &__type {
    color: $green-link;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
  }

  &__delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 50%;
    background: none;
    color: $text-faint;
    cursor: pointer;

    &:hover {
      background: $bg-soft;
      color: $text;
    }
  }

  &__feel {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    color: $text-muted;
    font-size: 13px;

    b {
      color: $text;
    }
  }

  &__wait {
    margin-top: 4px;
    color: $text-faint;
    font-size: 14px;
  }

  &__form {
    display: flex;
    flex: 1 1 320px;
    flex-direction: column;
    gap: 14px;

    @media (max-width: $bp-md) {
      order: -1;
    }
  }

  &__menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__menu-title {
    color: $text-nav;
    font-size: 14px;
  }

  &__menu-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  &__menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px 8px 8px;
    border: 1px solid $line-green;
    border-radius: 14px;
    background: $bg;
    color: $text;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease,
      transform 0.15s ease;

    &:hover {
      border-color: $accent;
    }

    &:active {
      transform: scale(0.98);
    }

    &.is-on {
      border-color: $accent;
      background: $bg-active;
      box-shadow: inset 0 0 0 1px $accent;
    }

    img,
    .diary__menu-ph {
      flex: none;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      object-fit: cover;
    }
  }

  &__menu-ph {
    display: grid;
    place-items: center;
    background: $bg-tint;
    color: $green-link;
  }

  &__menu-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;

    small {
      color: $green-link;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }
  }

  &__menu-done {
    flex: none;
    padding: 2px 8px;
    border-radius: $pill;
    background: $bg-soft;
    color: $text-faint;
    font-size: 12px;
  }

  &__for {
    color: $text-warn;
    font-size: 14px;
    font-weight: 700;
  }

  &__shot {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 120px;
    border: 2px dashed $line-dashed;
    border-radius: 16px;
    background: $bg;
    color: $green-link;
    font: inherit;
    font-weight: 700;
    cursor: pointer;

    &:hover {
      border-color: $accent;
    }
  }

  &__preview {
    position: relative;
    overflow: hidden;
    border-radius: 16px;

    img {
      display: block;
      width: 100%;
      max-height: 260px;
      object-fit: cover;
    }

    .btn {
      position: absolute;
      right: 10px;
      bottom: 10px;
    }
  }

  &__scale {
    display: flex;
    flex-direction: column;
    gap: 6px;

    > span {
      color: $text-nav;
      font-size: 14px;
    }
  }

  &__nums {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }

  &__nums button,
  &__moods button {
    min-height: 44px;
    border: 1px solid $line-green;
    border-radius: 12px;
    background: $bg;
    color: $text;
    font: inherit;
    cursor: pointer;

    &.is-on {
      border-color: $accent;
      background: $accent;
      color: #fff;
      font-weight: 700;
    }
  }

  &__moods {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    button {
      min-height: 40px;
      padding: 8px 12px;
      border-radius: $pill;
      font-size: 14px;

      &.is-on {
        background: $bg-active;
        color: $text-active;
      }
    }
  }

  &__hint {
    margin: 0;
    color: $text-faint;
    font-size: 13px;
    text-align: center;

    &--left {
      text-align: left;
    }
  }
}
</style>
