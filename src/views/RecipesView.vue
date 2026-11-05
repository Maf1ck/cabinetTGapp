<script setup lang="ts">
// База рецептів: нутриціолог веде її (створює, редагує), клієнт — переглядає.
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuth } from '@/stores/auth'
import AppIcon from '@/components/AppIcon.vue'
import {
  deleteRecipe,
  getRecipe,
  listIngredients,
  listRecipes,
  removeRecipePhoto,
  saveRecipe,
  setRecipePhoto,
  type Ingredient,
  type Recipe,
  type RecipeDraft,
  type RecipeLineDraft,
  type RecipeSummary,
} from '@/api/recipes'
import { normalize, UNITS } from '@/lib/recipes'
import { plural } from '@/lib/dates'
import { compressImage, MAX_UPLOAD_BYTES } from '@/lib/image'

const route = useRoute()
const router = useRouter()
const auth = useAuth()
const canEdit = computed(() => auth.isNutri)
const base = computed(() => (canEdit.value ? '/n/recipes' : '/c/recipes'))

const recipes = ref<RecipeSummary[]>([])
const loading = ref(true)
const loadError = ref(false)
const search = ref('')
const category = ref<string | null>(null)

const selectedId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const recipe = ref<Recipe | null>(null)
const recipeLoading = ref(false)
const recipeError = ref('')

// ---------------------------------------------------------------- список і пошук

const categories = computed(() => {
  const counts = new Map<string, number>()
  for (const r of recipes.value) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
})

const shown = computed(() => {
  const q = normalize(search.value)
  return recipes.value.filter(
    (r) =>
      (!category.value || r.category === category.value) &&
      (!q || [r.title, ...r.aliases, ...r.ingredients].some((s) => normalize(s).includes(q))),
  )
})

const counts = computed(() => {
  const n = recipes.value.length
  return `${n} ${plural(n, 'рецепт', 'рецепти', 'рецептів')} · ${categories.value.length} ${plural(categories.value.length, 'категорія', 'категорії', 'категорій')}`
})

// збіг за інгредієнтом — показуємо, чому рецепт у видачі
function matchHint(r: RecipeSummary): string | null {
  const q = normalize(search.value)
  if (!q || normalize(r.title).includes(q)) return null
  return r.ingredients.find((i) => normalize(i).includes(q)) ?? r.aliases.find((a) => normalize(a).includes(q)) ?? null
}

async function load() {
  loading.value = true
  loadError.value = false
  try {
    recipes.value = await listRecipes()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function loadRecipe(id: string) {
  recipeLoading.value = true
  recipeError.value = ''
  try {
    recipe.value = await getRecipe(id)
    if (!recipe.value) recipeError.value = 'Рецепт не знайдено — можливо, його видалили.'
  } catch {
    recipeError.value = 'Не вдалося відкрити рецепт.'
  } finally {
    recipeLoading.value = false
  }
}

const instructions = computed(() => (recipe.value?.instructions ?? '').split(/\n+/).filter((p) => p.trim()))

// ---------------------------------------------------------------- форма (нутриціолог)

const creating = computed(() => canEdit.value && route.query.new === '1')
const editing = ref(false)
const showForm = computed(() => creating.value || editing.value)
const catalog = ref<Ingredient[]>([])
const draft = ref<RecipeDraft>(emptyDraft())
const formError = ref('')
const saving = ref(false)

function emptyLine(): RecipeLineDraft {
  return { name: '', qty_from: null, qty_to: null, unit: 'г', note: null }
}

function emptyDraft(): RecipeDraft {
  return { title: '', category: null, servings: null, instructions: null, notes: null, lines: [emptyLine()] }
}

async function ensureCatalog() {
  if (!catalog.value.length) catalog.value = await listIngredients()
}

function startCreate() {
  router.push({ path: base.value, query: { new: '1' } })
}

async function startEdit() {
  const r = recipe.value
  if (!r) return
  draft.value = {
    title: r.title,
    category: r.category,
    servings: r.servings,
    instructions: r.instructions,
    notes: r.notes,
    lines: r.lines.length
      ? r.lines.map((l) => ({ name: l.name, qty_from: l.qty_from, qty_to: l.qty_to, unit: l.unit, note: l.note }))
      : [emptyLine()],
  }
  formError.value = ''
  editing.value = true
  ensureCatalog().catch(() => (formError.value = 'Не вдалося завантажити довідник інгредієнтів.'))
}

function cancelForm() {
  editing.value = false
  if (creating.value) router.push(base.value)
}

const addLine = () => draft.value.lines.push(emptyLine())
const removeLine = (i: number) => draft.value.lines.splice(i, 1)

// обрали інгредієнт із довідника — підставляємо його звичну одиницю
function pickIngredient(line: RecipeLineDraft) {
  const found = catalog.value.find((i) => normalize(i.name) === normalize(line.name))
  if (found?.default_unit && line.qty_from === null) line.unit = found.default_unit
}

const text = (s: string | null) => (s?.trim() ? s.trim() : null)
const qty = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))

async function submit() {
  const d = draft.value
  const title = d.title.trim()
  if (!title) {
    formError.value = 'Вкажіть назву страви.'
    return
  }
  const lines = d.lines
    .filter((l) => l.name.trim())
    .map((l) => {
      const from = qty(l.qty_from)
      const to = qty(l.qty_to)
      return { name: l.name.trim(), qty_from: from, qty_to: from !== null && to !== null && to !== from ? to : null, unit: l.unit, note: text(l.note) }
    })
  const bad = lines.find((l) => l.qty_to !== null && l.qty_from !== null && l.qty_to < l.qty_from)
  if (bad) {
    formError.value = `«${bad.name}»: кількість «до» менша за «від».`
    return
  }
  const taken = recipes.value.find((r) => normalize(r.title) === normalize(title) && r.id !== recipe.value?.id)
  if (taken && (creating.value || editing.value) && !window.confirm(`Рецепт «${taken.title}» уже є. Зберегти ще один з такою назвою?`)) return

  saving.value = true
  formError.value = ''
  try {
    await ensureCatalog()
    const saved = await saveRecipe(
      { title, category: text(d.category), servings: text(d.servings), instructions: text(d.instructions), notes: text(d.notes), lines },
      catalog.value,
      creating.value ? undefined : (recipe.value ?? undefined),
    )
    catalog.value = [] // могли додатися нові інгредієнти
    editing.value = false
    recipe.value = saved
    const summary: RecipeSummary = {
      id: saved.id,
      title: saved.title,
      category: saved.category,
      aliases: saved.aliases,
      ingredients: saved.lines.map((l) => l.name),
    }
    recipes.value = [...recipes.value.filter((r) => r.id !== saved.id), summary].sort((a, b) =>
      a.title.localeCompare(b.title, 'uk'),
    )
    if (selectedId.value !== saved.id) router.push(`${base.value}/${saved.id}`)
  } catch {
    formError.value = 'Не вдалося зберегти рецепт. Спробуйте ще раз.'
  } finally {
    saving.value = false
  }
}

async function remove() {
  const r = recipe.value
  if (!r || !window.confirm(`Видалити рецепт «${r.title}»? У вже складених меню страва лишиться, але без рецепта.`)) return
  try {
    await deleteRecipe(r)
    recipes.value = recipes.value.filter((x) => x.id !== r.id)
    recipe.value = null
    router.push(base.value)
  } catch {
    recipeError.value = 'Не вдалося видалити рецепт.'
  }
}

// ---------------------------------------------------------------- фото страви (нутриціолог)

const photoInput = ref<HTMLInputElement | null>(null)
const photoBusy = ref(false)
const photoError = ref('')
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

async function pickPhoto(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  const r = recipe.value
  if (!file || !r) return
  photoError.value = ''
  if (!file.type.startsWith('image/')) {
    photoError.value = 'Оберіть фото (JPG, PNG або WebP).'
    return
  }
  photoBusy.value = true
  try {
    const blob = await compressImage(file)
    if (!PHOTO_TYPES.includes(blob.type)) throw new Error('bad_type')
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('too_big')
    recipe.value = await setRecipePhoto(r, blob)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    photoError.value =
      code === 'bad_type'
        ? 'Цей формат не підходить — збережіть фото як JPG і спробуйте ще раз.'
        : code === 'too_big'
          ? 'Фото завелике навіть після стиснення.'
          : 'Не вдалося завантажити фото. Спробуйте ще раз.'
  } finally {
    photoBusy.value = false
  }
}

async function dropPhoto() {
  const r = recipe.value
  if (!r || !window.confirm('Прибрати фото страви?')) return
  photoBusy.value = true
  photoError.value = ''
  try {
    await removeRecipePhoto(r)
    recipe.value = { ...r, photo_path: null, photoUrl: null }
  } catch {
    photoError.value = 'Не вдалося прибрати фото.'
  } finally {
    photoBusy.value = false
  }
}

watch(
  selectedId,
  (id) => {
    editing.value = false
    recipe.value = null
    photoError.value = ''
    if (id) loadRecipe(id)
  },
  { immediate: true },
)

watch(creating, (on) => {
  if (!on) return
  draft.value = emptyDraft()
  formError.value = ''
  ensureCatalog().catch(() => (formError.value = 'Не вдалося завантажити довідник інгредієнтів.'))
}, { immediate: true })

onMounted(load)
</script>

<template lang="pug">
main.page.recipes
  .page-head
    div
      .page-head__sub(v-if='!loading && !loadError') {{ counts }}
      h1.page-head__title {{ canEdit ? 'База рецептів' : 'Рецепти' }}
    button.btn.btn--primary(v-if='canEdit' type='button' @click='startCreate') + Новий рецепт

  p.empty(v-if='loading') Завантажуємо…
  p.empty(v-else-if='loadError')
    | Не вдалося завантажити рецепти.
    |
    button.btn.btn--soft.btn--sm(type='button' @click='load') Спробувати ще раз

  .recipes__layout(v-else)
    //- список
    section.card.recipes__list(:class='{ "recipes__list--hidden": selectedId || showForm }')
      label.recipes__search
        span.sr-only Пошук рецепта
        input(v-model='search' type='search' placeholder='Страва або інгредієнт: курка, гречка…')
      .recipes__cats(v-if='categories.length > 1' role='group' aria-label='Категорія')
        button(type='button' :class='{ "is-on": !category }' :aria-pressed='!category' @click='category = null') Усі
        button(
          v-for='c in categories'
          :key='c.name'
          type='button'
          :class='{ "is-on": category === c.name }'
          :aria-pressed='category === c.name'
          @click='category = category === c.name ? null : c.name'
        ) {{ c.name }} #[span {{ c.count }}]
      p.empty(v-if='!recipes.length') {{ canEdit ? 'Рецептів поки немає. Додайте перший.' : 'Рецептів поки немає.' }}
      p.empty(v-else-if='!shown.length') Нічого не знайдено.
      .recipes__items
        RouterLink.recipes__item(v-for='r in shown' :key='r.id' :to='`${base}/${r.id}`' :class='{ "is-on": r.id === selectedId }')
          b {{ r.title }}
          span
            | {{ r.category || 'Без категорії' }}
            template(v-if='matchHint(r)')  · є {{ matchHint(r) }}
            template(v-else-if='r.ingredients.length')  · {{ r.ingredients.length }} {{ plural(r.ingredients.length, 'інгредієнт', 'інгредієнти', 'інгредієнтів') }}

    //- форма
    section.card.recipes__panel(v-if='showForm')
      RouterLink.recipes__back(:to='editing && recipe ? `${base}/${recipe.id}` : base' @click='cancelForm')
        AppIcon(name='chevronLeft' :size='18')
        | Назад
      h2.card__title {{ editing ? 'Редагувати рецепт' : 'Новий рецепт' }}
      form.recipes__fields(@submit.prevent='submit')
        label.field
          | Назва страви *
          input(v-model='draft.title' type='text' maxlength='120' placeholder='Гречка в духовці з куркою' required)
        .recipes__grid
          label.field
            | Категорія
            input(v-model='draft.category' type='text' list='recipe-categories' placeholder='Основна страва')
          label.field
            | Порцій
            input(v-model='draft.servings' type='text' maxlength='20' placeholder='2')
        datalist#recipe-categories
          option(v-for='c in categories' :key='c.name' :value='c.name')

        fieldset.recipes__lines
          legend Інгредієнти
          .recipes__line-head(aria-hidden='true')
            span Продукт
            span Кількість
            span Од.
            span Примітка
          .recipes__line(v-for='(l, i) in draft.lines' :key='i')
            input(v-model='l.name' type='text' list='recipe-ingredients' :aria-label='`Інгредієнт ${i + 1}`' placeholder='Куряче філе' @change='pickIngredient(l)')
            .recipes__qty
              input(v-model.number='l.qty_from' type='number' min='0' step='any' inputmode='decimal' :aria-label='`Кількість ${i + 1}`' placeholder='200')
              span –
              input(v-model.number='l.qty_to' type='number' min='0' step='any' inputmode='decimal' :aria-label='`Кількість до ${i + 1} (необовʼязково)`' placeholder='до')
            select(v-model='l.unit' :aria-label='`Одиниця ${i + 1}`')
              option(:value='null') —
              option(v-for='u in UNITS' :key='u' :value='u') {{ u }}
            input(v-model='l.note' type='text' :aria-label='`Примітка ${i + 1}`' placeholder='за смаком, натерти…')
            button.btn.btn--ghost.btn--sm.recipes__remove(type='button' :aria-label='`Прибрати інгредієнт ${i + 1}`' @click='removeLine(i)')
              AppIcon(name='close' :size='16')
          datalist#recipe-ingredients
            option(v-for='ing in catalog' :key='ing.id' :value='ing.name')
          button.btn.btn--soft.btn--sm(type='button' @click='addLine')
            AppIcon(name='plus' :size='16')
            | Інгредієнт
          p.recipes__hint Обирайте продукт зі списку — так його потім правильно порахує список покупок. Новий продукт додасться в довідник сам.

        label.field
          | Приготування
          textarea(v-model='draft.instructions' rows='7' placeholder='Покроково, як для клієнта: що нарізати, скільки готувати, при якій температурі.')
        label.field
          | Примітки
          textarea(v-model='draft.notes' rows='3' placeholder='Подача, гарнір, чим замінити продукт')
        p.notice(v-if='formError' role='alert') {{ formError }}
        .recipes__actions
          button.btn.btn--primary(type='submit' :disabled='saving') {{ saving ? 'Зберігаємо…' : editing ? 'Зберегти' : 'Створити рецепт' }}
          button.btn.btn--ghost(type='button' @click='cancelForm') Скасувати

    //- рецепт
    section.card.recipes__panel(v-else-if='selectedId')
      RouterLink.recipes__back(:to='base')
        AppIcon(name='chevronLeft' :size='18')
        | Усі рецепти
      p.empty(v-if='recipeLoading') Відкриваємо рецепт…
      p.notice(v-else-if='recipeError' role='alert') {{ recipeError }}
      template(v-else-if='recipe')
        .recipes__photo(v-if='recipe.photoUrl || canEdit' :class='{ "is-empty": !recipe.photoUrl }')
          img(v-if='recipe.photoUrl' :src='recipe.photoUrl' :alt='recipe.title')
          button.recipes__photo-add(v-else type='button' :disabled='photoBusy' @click='photoInput?.click()')
            AppIcon(name='camera' :size='26')
            span {{ photoBusy ? 'Завантажуємо…' : 'Додати фото страви' }}
            small Клієнт побачить його в меню й на головній
          .recipes__photo-actions(v-if='canEdit && recipe.photoUrl')
            button.btn.btn--white.btn--sm(type='button' :disabled='photoBusy' @click='photoInput?.click()') {{ photoBusy ? 'Завантажуємо…' : 'Замінити фото' }}
            button.btn.btn--white.btn--sm(type='button' :disabled='photoBusy' @click='dropPhoto') Прибрати
          input.sr-only(v-if='canEdit' ref='photoInput' type='file' accept='image/jpeg,image/png,image/webp,image/*' @change='pickPhoto')
        p.notice(v-if='photoError' role='alert') {{ photoError }}
        div
          .recipes__tags
            span.chip(v-if='recipe.category') {{ recipe.category }}
            span.chip.chip--plain(v-if='recipe.servings') Порцій: {{ recipe.servings }}
          h2.recipes__title {{ recipe.title }}
          p.recipes__muted(v-if='recipe.aliases.length') Також: {{ recipe.aliases.join(', ') }}

        .recipes__body
          section.recipes__block
            h3 Інгредієнти
            p.empty(v-if='!recipe.lines.length') Склад не вказано.
            ul.recipes__ingredients(v-else)
              li(v-for='l in recipe.lines' :key='l.id')
                span
                  | {{ l.name }}
                  small(v-if='l.note') {{ l.note }}
                b {{ l.amount || '' }}
          section.recipes__block
            h3 Приготування
            p.empty(v-if='!instructions.length') Інструкції поки немає.
            ol.recipes__steps(v-else-if='instructions.length > 1')
              li(v-for='(p, i) in instructions' :key='i') {{ p }}
            p.recipes__text(v-else) {{ instructions[0] }}
            .tip(v-if='recipe.notes') #[b Примітка.] {{ recipe.notes }}

        p.recipes__muted(v-if='canEdit && recipe.source') Джерело: {{ recipe.source }}
        .recipes__actions(v-if='canEdit')
          button.btn.btn--primary(type='button' @click='startEdit') Редагувати
          button.btn.btn--ghost(type='button' @click='remove') Видалити

    section.card.recipes__panel.recipes__placeholder(v-else-if='recipes.length')
      AppIcon(name='book' :size='32')
      p {{ canEdit ? 'Оберіть рецепт зі списку або додайте новий.' : 'Оберіть рецепт зі списку. Шукати можна й за продуктом, який є вдома.' }}
</template>

<style lang="scss">
@use '@/scss/variables' as *;

.recipes {
  &__photo {
    position: relative;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    max-height: 320px;
    margin: 4px 0 18px;
    border-radius: 18px;
    background: $bg-tint;

    img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    &.is-empty {
      aspect-ratio: auto;
      border: 2px dashed $line-dashed;
      background: $bg-soft;
    }
  }

  &__photo-add {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 26px 16px;
    border: 0;
    background: transparent;
    color: $text-nav;
    font: inherit;
    font-weight: 600;
    cursor: pointer;

    small {
      color: $text-faint;
      font-weight: 400;
    }

    &:hover:not(:disabled) {
      color: $accent;
    }
  }

  &__photo-actions {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 6px;
  }

  &__layout {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 22px;
  }

  &__list {
    position: sticky;
    top: 16px;
    display: flex;
    flex: 1 1 300px;
    flex-direction: column;
    gap: 8px;
    max-height: calc(100vh - 32px);
    padding: 12px;

    @media (max-width: $bp-md) {
      position: static;
      max-height: none;

      // на телефоні список ховається, коли відкрито рецепт чи форму
      &--hidden {
        display: none;
      }
    }
  }

  &__search {
    display: flex;
    padding: 6px 6px 0;

    input {
      flex: 1;
      min-height: 44px;
      padding: 10px 14px;
      border: 1px solid $line-green;
      border-radius: $pill;
      background: $bg-app;
      font: inherit;
    }
  }

  &__cats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px 6px;

    button {
      min-height: 32px;
      padding: 4px 12px;
      border: 1px solid $line-green;
      border-radius: $pill;
      background: $bg;
      color: $text-nav;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;

      span {
        color: $text-faint;
      }

      &:hover {
        border-color: $accent;
      }

      &.is-on {
        border-color: $accent;
        background: $accent;
        color: #fff;

        span {
          color: $badge-bg;
        }
      }
    }
  }

  &__items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    overflow-y: auto;
  }

  &__item {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border-radius: 14px;
    color: $text;
    text-decoration: none;

    span {
      color: $text-muted;
      font-size: 13px;
    }

    &:hover {
      background: $bg-soft;
      color: $text;
    }

    &.is-on {
      background: $bg-active;
    }
  }

  &__panel {
    display: flex;
    flex: 999 1 520px;
    flex-direction: column;
    gap: 20px;
  }

  &__placeholder {
    align-items: center;
    padding: 48px 24px;
    color: $text-muted;
    text-align: center;
  }

  &__back {
    display: none;
    align-items: center;
    gap: 4px;
    font-size: 14px;
    font-weight: 700;
    text-decoration: none;

    @media (max-width: $bp-md) {
      display: inline-flex;
    }
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;

    .chip--plain {
      background: $bg-soft;
      color: $text-nav;
    }
  }

  &__title {
    font-size: 30px;

    @media (max-width: $bp-md) {
      font-size: 24px;
    }
  }

  &__muted,
  &__hint {
    color: $text-muted;
    font-size: 14px;
  }

  &__body {
    display: grid;
    grid-template-columns: minmax(240px, 2fr) 3fr;
    gap: 24px;

    @media (max-width: 1100px) {
      grid-template-columns: 1fr;
    }
  }

  &__block {
    display: flex;
    flex-direction: column;
    gap: 12px;

    h3 {
      font-family: $font-body;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: $text-muted;
    }
  }

  &__ingredients {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 0;
      border-bottom: 1px solid $line-soft;

      &:last-child {
        border-bottom: 0;
      }
    }

    span {
      display: flex;
      flex-direction: column;
    }

    small {
      color: $text-faint;
      font-size: 13px;
    }

    b {
      flex: none;
      color: $text-active;
      white-space: nowrap;
    }
  }

  &__steps {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 0;
    padding-left: 22px;
    line-height: 1.6;
  }

  &__text {
    line-height: 1.7;
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  // ---------- форма
  &__fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  &__grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 12px;
  }

  &__lines {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 16px;
    border: 1px solid $line;
    border-radius: 18px;
    background: $bg-soft;

    legend {
      padding: 0 6px;
      color: $text-nav;
      font-size: 14px;
      font-weight: 700;
    }

    input,
    select {
      width: 100%;
      min-width: 0;
      min-height: 40px;
      padding: 8px 10px;
      border: 1px solid $line-green;
      border-radius: 10px;
      background: $bg;
      color: $text;
      font: inherit;
      font-size: 14px;

      &:focus {
        border-color: $accent;
        outline: none;
      }
    }
  }

  &__line-head,
  &__line {
    display: grid;
    grid-template-columns: minmax(140px, 2fr) minmax(130px, 1.3fr) 76px minmax(110px, 1.6fr) 38px;
    gap: 6px;
    width: 100%;
  }

  &__line-head {
    color: $text-faint;
    font-size: 12px;
    font-weight: 700;

    @media (max-width: $bp-md) {
      display: none;
    }
  }

  &__line {
    @media (max-width: $bp-md) {
      grid-template-columns: 1fr 76px 38px;
      padding-bottom: 10px;
      border-bottom: 1px solid $line;

      > :first-child {
        grid-column: 1 / -1;
      }

      .recipes__qty {
        grid-column: 1;
      }

      > :nth-child(4) {
        grid-column: 1 / 3;
        grid-row: 3;
      }

      .recipes__remove {
        grid-row: 3;
      }
    }
  }

  &__qty {
    display: flex;
    align-items: center;
    gap: 4px;

    span {
      color: $text-faint;
    }
  }

  &__remove {
    width: 38px;
    min-height: 40px;
    padding: 0;
  }
}
</style>
