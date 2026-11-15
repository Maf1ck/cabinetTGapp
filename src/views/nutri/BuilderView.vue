<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import HintCard from '@/components/HintCard.vue'
import MealProductsEditor from '@/components/MealProductsEditor.vue'
import SuggestInput, { type Suggestion } from '@/components/SuggestInput.vue'
import {
  discardMenuDraft,
  ensureMenu,
  getMenuForEdit,
  hideMenu,
  listClients,
  publishMenu,
  saveMenuDraft,
  type ClientRow,
  type EditableMeal,
  type EditableMenu,
} from '@/api/nutri'
import { addDays, DAY_SHORT, isoDate, plural, shortDate, weekStart } from '@/lib/dates'
import {
  changedMealIds,
  hasOwnTitle,
  hhmm,
  MEAL_LABEL,
  MEAL_TIME,
  MEALS,
  productsLine,
  productsOf,
  PRODUCTS_MAX,
  sameMeals,
  titleFromProducts,
  type MealProduct,
  type MealType,
} from '@/lib/meals'
import {
  CATEGORY_SHORT,
  cleanProducts,
  isGarnishCategory,
  plainGarnishes,
  portionFromRecipe,
  productCategories,
  productFromIngredient,
  recipeFromProducts,
  searchProducts,
  switchRecipeProducts,
} from '@/lib/products'
import { shortName } from '@/lib/clients'
import {
  getRecipe,
  listIngredients,
  listRecipes,
  saveRecipe,
  type Ingredient,
  type Recipe,
  type RecipeSummary,
} from '@/api/recipes'
import { normalize } from '@/lib/recipes'

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
const editor = ref<{
  day: number
  meal: MealType
  id?: string
  title: string
  time: string
  recipeId: string | null
  products: MealProduct[]
} | null>(null)
const titleInput = ref<InstanceType<typeof SuggestInput> | null>(null)
const productsEditor = ref<InstanceType<typeof MealProductsEditor> | null>(null)

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
const eatenPerDay = (day: number) => meals.value.filter((m) => m.day === day && m.eaten).length
const eatenTotal = computed(() => meals.value.filter((m) => m.eaten).length)
const changed = computed(() => (menu.value?.hasDraft ? changedMealIds(menu.value.saved, meals.value) : new Set<string>()))
const canSave = computed(
  () => !menuLoading.value && !!menu.value && (menu.value.hasDraft || (!menu.value.published && meals.value.length > 0)),
)
const stateLabel = computed(() => {
  if (!menu.value?.published) return 'Чернетка'
  return menu.value.hasDraft ? 'Опубліковано · є чернетка' : 'Опубліковано'
})
const dayIso = (day: number) => isoDate(addDays(monday.value, day - 1))
/** день настав (сьогодні чи раніше) — показуємо, скільки відмічено */
const isPast = (day: number) => dayIso(day) <= isoDate(now)
/** день минув, а страву так і не відмітили */
const missed = (day: number, meal: MealType) => {
  const m = cell(day, meal)
  return !!m && !!menu.value?.published && !m.eaten && dayIso(day) < isoDate(now)
}
// підказки для поля «страва»: рецепти з бази і все, що вже є в цьому меню
const suggestions = computed<Suggestion[]>(() => {
  const fromBook = recipes.value.map((r) => ({ value: r.title, hint: r.category || 'рецепт', keys: r.aliases }))
  const seen = new Set(fromBook.map((s) => normalize(s.value)))
  const fromMenu = [...new Set(meals.value.map((m) => m.title))]
    .filter((t) => !seen.has(normalize(t)))
    .map((t) => ({ value: t, hint: 'у меню' }))
  return [...fromBook, ...fromMenu]
})

// ---------------------------------------------------------------- рецепти з бази
const recipes = ref<RecipeSummary[]>([])
const recipeById = computed(() => new Map(recipes.value.map((r) => [r.id, r])))
const linkedRecipe = computed(() => (editor.value?.recipeId ? recipeById.value.get(editor.value.recipeId) : undefined))

// Список рецептів у вікні страви: без тексту — за категорією, з текстом — пошук по всій базі
const listCategory = ref<string | null>(null)
const recipeCategories = computed(() => {
  const counts = new Map<string, number>()
  for (const r of recipes.value) if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
})
// яку категорію відкривати для прийому їжі (якщо така є в базі)
const MEAL_CATEGORY: Record<MealType, string[]> = {
  breakfast: ['Сніданок'],
  snack1: ['Перекус', 'Закуска'],
  lunch: ['Основна страва'],
  snack2: ['Перекус', 'Закуска'],
  dinner: ['Основна страва'],
}
const defaultCategory = (meal: MealType) =>
  MEAL_CATEGORY[meal].find((c) => recipeCategories.value.some((x) => x.name === c)) ?? null

const recipeQuery = ref('')
const searching = computed(() => normalize(recipeQuery.value).length >= 2)
const recipeList = computed(() => {
  const q = normalize(recipeQuery.value)
  if (!searching.value) return recipes.value.filter((r) => !listCategory.value || r.category === listCategory.value)
  // спершу збіг на початку назви, далі в назві чи іншій назві, потім — за інгредієнтом
  const score = (r: RecipeSummary) =>
    normalize(r.title).startsWith(q)
      ? 0
      : normalize(r.title).includes(q) || r.aliases.some((a) => normalize(a).includes(q))
        ? 1
        : r.ingredients.some((i) => normalize(i).includes(q))
          ? 2
          : 9
  return recipes.value
    .map((r) => ({ r, s: score(r) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || a.r.title.localeCompare(b.r.title, 'uk'))
    .map((x) => x.r)
})

async function loadRecipes() {
  // без підказок конструктор усе одно працює — страву й продукти можна вписати вручну
  const [r, i] = await Promise.allSettled([listRecipes(), listIngredients()])
  if (r.status === 'fulfilled') recipes.value = r.value
  if (i.status === 'fulfilled') ingredients.value = i.value
}

// ---------------------------------------------------------------- продукти з довідника (гречка, овочі, олія…)
const ingredients = ref<Ingredient[]>([])
const bookTab = ref<'recipes' | 'products'>('recipes')
const productCategory = ref<string | null>(null)
const productQuery = ref('')
const productSearching = computed(() => normalize(productQuery.value).length >= 2)
const productCats = computed(() => productCategories(ingredients.value))
const productList = computed(() =>
  productSearching.value
    ? searchProducts(ingredients.value, productQuery.value)
    : ingredients.value.filter((i) => i.category === productCategory.value),
)
const hasBook = computed(() => recipes.value.length > 0 || ingredients.value.length > 0)
const inMeal = (i: Ingredient) => !!editor.value?.products.some((p) => p.ingredient_id === i.id)

/** Додає продукт у прийом їжі й ставить курсор у кількість; уже доданий — просто фокус на ньому */
function addProduct(i: Ingredient) {
  const e = editor.value
  if (!e) return
  const at = e.products.findIndex((p) => p.ingredient_id === i.id)
  if (at >= 0) return productsEditor.value?.focusQty(at)
  if (e.products.length >= PRODUCTS_MAX) return
  e.products = [...e.products, productFromIngredient(i)]
  productsEditor.value?.focusQty(e.products.length - 1)
}

/** У клітинці: назва страви, якщо вона не складена з самих продуктів, і продукти з грамовкою */
const ownTitle = (m: EditableMeal | undefined) => !!m && hasOwnTitle(m)
const cellProducts = (m: EditableMeal | undefined) => (m ? productsLine(m) : '')

// ---------------------------------------------------------------- склад рецепта з грамовкою на порцію
const fullRecipes = new Map<string, Recipe>()
const portionLoading = ref(false)
const portionError = ref('')

async function fullRecipe(id: string): Promise<Recipe | null> {
  const cached = fullRecipes.get(id)
  if (cached) return cached
  const r = await getRecipe(id)
  if (r) fullRecipes.set(id, r)
  return r
}

/**
 * Привʼязує рецепт і підставляє його склад на одну порцію: грамовки за замовчуванням
 * з рецепта, нутриціолог править їх під клієнта.
 */
async function applyRecipe(r: RecipeSummary) {
  const e = editor.value
  if (!e) return
  // той самий рецепт уже розписаний — грамовки нутриціолога не скидаємо
  if (e.recipeId === r.id && e.products.length) {
    e.title = r.title
    return
  }
  const prevId = e.recipeId
  e.title = r.title
  e.recipeId = r.id
  portionLoading.value = true
  portionError.value = ''
  try {
    const [full, prev] = await Promise.all([
      fullRecipe(r.id),
      // склад попереднього рецепта прибираємо, свої продукти лишаємо
      prevId ? fullRecipe(prevId).catch(() => null) : null,
    ])
    // поки вантажили, могли закрити вікно чи обрати інший рецепт
    if (!full || editor.value !== e || e.recipeId !== r.id) return
    const previous = prev ? portionFromRecipe(prev, ingredients.value) : []
    e.products = switchRecipeProducts(e.products, previous, portionFromRecipe(full, ingredients.value))
  } catch {
    portionError.value = 'Не вдалося завантажити склад рецепта — грамовку можна вписати вручну.'
  } finally {
    portionLoading.value = false
  }
}

const pickRecipe = (r: RecipeSummary) => applyRecipe(r)

// змінили назву вручну — посилання на рецепт лишається, лише якщо назва збігається
function onTitleInput() {
  const e = editor.value
  if (!e) return
  const exact = recipes.value.find((r) => normalize(r.title) === normalize(e.title))
  if (exact && exact.id !== e.recipeId) applyRecipe(exact)
  else if (!exact) e.recipeId = null
}

// ---------------------------------------------------------------- зберегти прийом їжі як рецепт
const saveAs = ref<{ title: string; category: string | null; busy: boolean; error: string } | null>(null)
const categoryOptions = computed<Suggestion[]>(() => recipeCategories.value.map((c) => ({ value: c.name, hint: String(c.count) })))
const canSaveAsRecipe = computed(() => !!editor.value && cleanProducts(editor.value.products).length > 0)

function startSaveAs() {
  const e = editor.value
  if (!e) return
  saveAs.value = {
    title: e.title.trim() || titleFromProducts(cleanProducts(e.products)),
    category: linkedRecipe.value?.category ?? listCategory.value,
    busy: false,
    error: '',
  }
}

async function saveAsRecipe() {
  const s = saveAs.value
  const e = editor.value
  if (!s || !e || s.busy) return
  const title = s.title.trim()
  if (!title) {
    s.error = 'Вкажіть назву рецепта.'
    return
  }
  if (recipes.value.some((r) => normalize(r.title) === normalize(title))) {
    s.error = `Рецепт «${title}» уже є в базі — змініть назву.`
    return
  }
  s.busy = true
  s.error = ''
  try {
    const products = cleanProducts(e.products)
    // варіант рецепта з бази — приготування беремо з нього
    const base = e.recipeId ? fullRecipes.get(e.recipeId) : undefined
    const saved = await saveRecipe(
      recipeFromProducts(title, s.category?.trim() || null, products, base?.instructions ?? null),
      ingredients.value,
    )
    fullRecipes.set(saved.id, saved)
    recipes.value = [
      ...recipes.value,
      { id: saved.id, title: saved.title, category: saved.category, aliases: saved.aliases, ingredients: saved.lines.map((l) => l.name) },
    ].sort((a, b) => a.title.localeCompare(b.title, 'uk'))
    // свої продукти потрапили в довідник — тепер вони з id
    e.products = products.map((p, i) => ({ ...p, ingredient_id: saved.lines[i]?.ingredient_id ?? p.ingredient_id }))
    e.title = saved.title
    e.recipeId = saved.id
    saveAs.value = null
    listIngredients()
      .then((list) => (ingredients.value = list))
      .catch(() => undefined)
  } catch {
    s.error = 'Не вдалося зберегти рецепт. Спробуйте ще раз.'
  } finally {
    s.busy = false
  }
}

// ---------------------------------------------------------------- прості гарніри у «Рецептах → Гарнір»
const showGarnishes = computed(() => !searching.value && isGarnishCategory(listCategory.value))
const garnishList = computed(() => (showGarnishes.value ? plainGarnishes(ingredients.value) : []))

const unlinkRecipe = () => {
  if (editor.value) editor.value.recipeId = null
}

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
    recipeId: existing?.recipe_id ?? null,
    products: existing ? productsOf(existing).map((p) => ({ ...p })) : [],
  }
  listCategory.value = defaultCategory(meal)
  recipeQuery.value = ''
  productQuery.value = ''
  productCategory.value ??= productCats.value[0]?.name ?? null
  saveAs.value = null
  portionError.value = ''
  // страва з рецептом зі старого меню, ще без розписаної порції — підставляємо склад з рецепта
  const linked = existing?.recipe_id ? recipeById.value.get(existing.recipe_id) : undefined
  if (linked && !editor.value.products.length) void applyRecipe(linked)
  nextTick(() => titleInput.value?.focus())
}

/** Усі правки йдуть у чернетку; повернули все як було — чернетка зникає. */
async function writeDraft(next: EditableMeal[]) {
  const target = menu.value ?? (await ensureMenu(clientId.value, weekIso.value))
  const same = sameMeals(target.saved, next)
  if (same) await discardMenuDraft(target.id)
  else await saveMenuDraft(target.id, next)
  menu.value = { ...target, meals: same ? target.saved : next, hasDraft: !same }
}

function saveEditor() {
  const e = editor.value
  if (!e) return
  const products = cleanProducts(e.products)
  // лише продукти без страви — назва складається з них: «Гречка, Огірок»
  const title = e.title.trim() || titleFromProducts(products)
  if (!title) return removeFromEditor()
  run(async () => {
    const before = meals.value.find((m) => m.id === e.id)
    await writeDraft([
      ...meals.value.filter((m) => m.id !== e.id),
      {
        id: e.id ?? crypto.randomUUID(),
        day: e.day,
        meal: e.meal,
        at_time: e.time || null,
        title,
        recipe_id: e.recipeId,
        products,
        eaten: before?.eaten ?? false,
      },
    ])
    editor.value = null
  }, 'Не вдалося зберегти чернетку.')
}

function removeFromEditor() {
  const e = editor.value
  if (!e?.id) {
    editor.value = null
    return
  }
  const id = e.id
  run(async () => {
    await writeDraft(meals.value.filter((m) => m.id !== id))
    editor.value = null
  }, 'Не вдалося видалити страву.')
}

function saveMenu() {
  const m = menu.value
  if (!m) return
  if (!m.meals.length) {
    error.value = 'Додайте хоча б одну страву, перш ніж надсилати меню.'
    return
  }
  run(async () => {
    await publishMenu(m.id)
    menu.value = await getMenuForEdit(clientId.value, weekIso.value)
  }, 'Не вдалося зберегти меню. Чернетка лишилась, спробуйте ще раз.')
}

function discardDraft() {
  const m = menu.value
  if (!m || !window.confirm('Скасувати всі зміни чернетки? Меню повернеться до останньої збереженої версії.')) return
  run(async () => {
    await discardMenuDraft(m.id)
    menu.value = { ...m, meals: m.saved, hasDraft: false }
  }, 'Не вдалося скасувати зміни.')
}

function hideFromClient() {
  const m = menu.value
  if (!m) return
  run(async () => {
    await hideMenu(m.id)
    menu.value = { ...m, published: false }
  }, 'Не вдалося сховати меню.')
}

function copyPrevious() {
  if (meals.value.length && !window.confirm('Замінити страви цього тижня стравами з попереднього?')) return
  run(async () => {
    const source = await getMenuForEdit(clientId.value, isoDate(addDays(monday.value, -7)))
    if (!source?.meals.length) error.value = 'Минулого тижня меню для цього клієнта не було.'
    else await writeDraft(source.meals.map((m) => ({ ...m, id: crypto.randomUUID(), eaten: false })))
  }, 'Не вдалося скопіювати меню.')
}

const shiftWeek = (delta: number) => (monday.value = addDays(monday.value, delta * 7))

watch([clientId, weekIso], () => {
  editor.value = null
  if (clientId.value) router.replace({ query: { ...route.query, client: clientId.value } })
  loadMenu()
})

onMounted(() => {
  loadClients()
  loadRecipes()
})

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
      span.builder__state(:class='{ "is-live": menu.published && !menu.hasDraft }') {{ stateLabel }}
      button.btn.btn--ghost(v-if='menu.published' type='button' :disabled='busy' @click='hideFromClient') Сховати від клієнта

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

    HintCard(id='builder' title='Підказки до конструктора')
      ul
        li Обирайте страви з бази рецептів: клієнт побачить склад і приготування, а список покупок порахується сам.
        li Гречку, рис, макарони, овочі, фрукти, олію додавайте у вкладці «Продукти» й вкажіть грамовку — окремо або разом зі стравою. Прості крупи є й у «Рецепти → Гарнір».
        li Обрали рецепт — його інгредієнти підставляться з грамовкою на одну порцію. Змініть вагу під клієнта або залиште як є.
        li Склали страву з продуктів — «Зберегти як рецепт» додасть її в базу з вашою назвою.
        li Додайте фото до рецепта в #[RouterLink(to='/n/recipes') Базі рецептів] — воно зʼявиться в меню клієнта.
        li В опублікованому меню видно, що клієнт відмітив зʼїденим (зелена клітинка з ✓).
        li Зміни зберігаються як чернетка, її можна закрити й повернутись пізніше. Клієнт побачить їх і отримає сповіщення лише після «Зберегти й надіслати». Змінені страви обведені.

    section.card
      p.empty(v-if='menuLoading') Завантажуємо меню…
      template(v-else)
        p.builder__hint(v-if='!meals.length') Натисніть на клітинку, щоб додати страву. Меню побачить {{ client ? shortName(client.full_name) : 'клієнт' }} лише після «Зберегти й надіслати».
        .builder__legend(v-else-if='menu?.published')
          span #[i.builder__dot.is-eaten] зʼїдено — клієнт відмітив
          span #[i.builder__dot.is-missed] минулий день без відмітки
          b Відмічено: {{ eatenTotal }} з {{ meals.length }}
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
                :class='{ "is-empty": !cell(d.day, t), "is-editing": editor?.day === d.day && editor?.meal === t, "is-eaten": cell(d.day, t)?.eaten, "is-missed": missed(d.day, t), "is-changed": changed.has(cell(d.day, t)?.id ?? "") }'
                :aria-label='cellLabel(cell(d.day, t), d.day, t)'
                @click='openEditor(d.day, t)'
              )
                template(v-if='cell(d.day, t)')
                  span.builder__time(v-if='cell(d.day, t)?.at_time') {{ hhmm(cell(d.day, t)?.at_time ?? null) }}
                  span(v-if='ownTitle(cell(d.day, t))') {{ cell(d.day, t)?.title }}
                  span.builder__products(v-if='cellProducts(cell(d.day, t))') {{ cellProducts(cell(d.day, t)) }}
                  span.builder__linked(v-if='cell(d.day, t)?.recipe_id')
                    AppIcon(name='book' :size='12')
                    | рецепт
                  span.builder__eaten(v-if='cell(d.day, t)?.eaten')
                    AppIcon(name='check' :size='12')
                    | зʼїдено
                AppIcon(v-else name='plus' :size='18')
            .builder__type.builder__type--muted Разом
            .builder__total(v-for='d in weekDays' :key='`sum-${d.day}`' :class='{ "is-warn": perDay(d.day) === 0 }')
              | {{ perDay(d.day) ? `${perDay(d.day)} ${plural(perDay(d.day), 'прийом', 'прийоми', 'прийомів')}` : 'Порожньо' }}
              small.builder__total-eaten(v-if='menu?.published && perDay(d.day) && isPast(d.day)') ✓ {{ eatenPerDay(d.day) }} з {{ perDay(d.day) }}

    //- чернетка вже в базі: клієнт отримає її лише з цієї панелі
    Transition(name='builder-bar')
      .builder__bar(v-if='canSave' role='status')
        span.builder__bar-text
          b {{ menu?.hasDraft ? 'Чернетку збережено' : 'Меню ще не надіслане' }}
          small {{ menu?.published ? 'Клієнт бачить попередню версію, доки ви не збережете зміни' : 'Клієнт побачить меню після збереження' }}
        button.btn.btn--ghost.btn--sm(v-if='menu?.hasDraft' type='button' :disabled='busy' @click='discardDraft') Скасувати зміни
        button.btn.btn--primary.btn--sm(type='button' :disabled='busy' @click='saveMenu') Зберегти й надіслати

  //- редактор страви
  Transition(name='builder-dialog')
    .builder__overlay(v-if='editor' @click.self='editor = null' @keydown.esc='editor = null')
      form.builder__dialog(
        role='dialog'
        aria-modal='true'
        :class='{ "builder__dialog--wide": hasBook }'
        :aria-label='`${MEAL_LABEL[editor.meal]}, ${DAY_SHORT[editor.day - 1]}`'
        @submit.prevent='saveEditor'
      )
        .builder__dialog-main
          .builder__dialog-head
            div
              .eyebrow {{ DAY_SHORT[editor.day - 1] }}, {{ shortDate(addDays(monday, editor.day - 1)) }}
              h2.card__title {{ MEAL_LABEL[editor.meal] }}
            button.btn.btn--ghost.btn--sm.builder__arrow(type='button' aria-label='Закрити' @click='editor = null')
              AppIcon(name='close' :size='18')
          label.field
            | Страва
            SuggestInput(
              ref='titleInput'
              v-model='editor.title'
              :options='suggestions'
              :placeholder='editor.products.length ? "Необовʼязково, якщо є продукти" : recipes.length ? "Оберіть рецепт або впишіть страву" : "Напр.: вівсянка з ягодами"'
              maxlength='120'
              @typed='onTitleInput'
              @pick='onTitleInput'
            )
          .builder__recipe(v-if='linkedRecipe')
            AppIcon(name='book' :size='18')
            span
              b Рецепт із бази
              small {{ linkedRecipe.category || 'Без категорії' }} · склад нижче — на одну порцію, грамовку можна змінити
            .builder__recipe-actions
              RouterLink.btn.btn--ghost.btn--sm(:to='`/n/recipes/${linkedRecipe.id}`' target='_blank') Відкрити
              button.btn.btn--ghost.btn--sm(type='button' @click='unlinkRecipe') Відвʼязати
          p.builder__hint.builder__hint--tight(v-else-if='editor.title.trim() && recipes.length && !editor.products.length') Без рецепта — клієнт побачить лише назву.
          p.builder__hint.builder__hint--tight(v-if='portionLoading' role='status') Підставляємо склад рецепта…
          p.notice(v-if='portionError' role='alert') {{ portionError }}
          MealProductsEditor(ref='productsEditor' v-model='editor.products')

          //- склад прийому їжі → новий рецепт у базі
          .builder__save-as(v-if='saveAs')
            label.field
              | Назва рецепта
              input(v-model='saveAs.title' type='text' maxlength='120' placeholder='Гречка з овочами' @keydown.enter.prevent='saveAsRecipe')
            label.field
              | Категорія
              SuggestInput(v-model='saveAs.category' :options='categoryOptions' open-on-focus placeholder='Гарнір' @keydown.enter.prevent)
            p.builder__hint.builder__hint--tight Рецепт на одну порцію з цими грамовками.{{ linkedRecipe ? ' Приготування візьметься з рецепта «' + linkedRecipe.title + '».' : '' }}
            p.notice(v-if='saveAs.error' role='alert') {{ saveAs.error }}
            .builder__save-as-actions
              button.btn.btn--primary.btn--sm(type='button' :disabled='saveAs.busy' @click='saveAsRecipe') {{ saveAs.busy ? 'Зберігаємо…' : 'Зберегти рецепт' }}
              button.btn.btn--ghost.btn--sm(type='button' :disabled='saveAs.busy' @click='saveAs = null') Скасувати
          button.btn.btn--soft.btn--sm.builder__save-as-open(v-else-if='canSaveAsRecipe' type='button' @click='startSaveAs')
            AppIcon(name='book' :size='16')
            | {{ linkedRecipe ? 'Зберегти як новий рецепт' : 'Зберегти як рецепт' }}
          label.field
            | Час
            input(v-model='editor.time' type='time')

        //- база рецептів і довідник продуктів збоку
        aside.builder__book(v-if='hasBook' aria-label='Що додати')
          .builder__tabs(role='tablist' aria-label='Що додати')
            button(type='button' role='tab' :aria-selected='bookTab === "recipes"' :class='{ "is-on": bookTab === "recipes" }' @click='bookTab = "recipes"') Рецепти
            button(type='button' role='tab' :aria-selected='bookTab === "products"' :class='{ "is-on": bookTab === "products" }' @click='bookTab = "products"') Продукти

          template(v-if='bookTab === "products"')
            label.builder__book-search
              span.sr-only Пошук продукту
              input(v-model='productQuery' type='search' placeholder='Пошук: гречка, огірок, олія…' autocomplete='off')
            .builder__cats(v-if='!productSearching' role='group' aria-label='Категорія продуктів')
              button(
                v-for='c in productCats'
                :key='c.name'
                type='button'
                :class='{ "is-on": productCategory === c.name }'
                :aria-pressed='productCategory === c.name'
                @click='productCategory = c.name'
              ) {{ CATEGORY_SHORT[c.name] ?? c.name }} #[span {{ c.count }}]
            span.builder__label(v-else) Знайдено: {{ productList.length }}
            .builder__list
              button(
                v-for='i in productList'
                :key='i.id'
                type='button'
                :class='{ "is-on": inMeal(i) }'
                :aria-pressed='inMeal(i)'
                @click='addProduct(i)'
              )
                b {{ i.name }}
                small(v-if='productSearching') {{ i.category || 'Без категорії' }}
                AppIcon(:name='inMeal(i) ? "check" : "plus"' :size='16')
              p.builder__hint.builder__hint--tight(v-if='!productList.length') Нічого не знайдено — додайте «Свій продукт» зліва.

          template(v-else)
            label.builder__book-search
              span.sr-only Пошук рецепта
              input(v-model='recipeQuery' type='search' placeholder='Пошук: назва чи продукт' autocomplete='off')
            .builder__cats(v-if='!searching' role='group' aria-label='Категорія')
              button(type='button' :class='{ "is-on": !listCategory }' :aria-pressed='!listCategory' @click='listCategory = null') Усі #[span {{ recipes.length }}]
              button(
                v-for='c in recipeCategories'
                :key='c.name'
                type='button'
                :class='{ "is-on": listCategory === c.name }'
                :aria-pressed='listCategory === c.name'
                @click='listCategory = c.name'
              ) {{ c.name }} #[span {{ c.count }}]
            span.builder__label(v-else) Знайдено: {{ recipeList.length }}
            .builder__list
              //- «Гарнір»: спершу сама крупа, макарони, картопля — з власною грамовкою
              template(v-if='garnishList.length')
                p.builder__group Просто крупа чи гарнір — вкажіть грамовку
                button(
                  v-for='i in garnishList'
                  :key='`g-${i.id}`'
                  type='button'
                  :class='{ "is-on": inMeal(i) }'
                  :aria-pressed='inMeal(i)'
                  @click='addProduct(i)'
                )
                  b {{ i.name }}
                  small продукт
                  AppIcon(:name='inMeal(i) ? "check" : "plus"' :size='16')
                p.builder__group(v-if='recipeList.length') Рецепти
              button(
                v-for='r in recipeList'
                :key='r.id'
                type='button'
                :class='{ "is-on": r.id === editor.recipeId }'
                :aria-pressed='r.id === editor.recipeId'
                @click='pickRecipe(r)'
              )
                b {{ r.title }}
                small(v-if='searching || !listCategory') {{ r.category || 'Без категорії' }}
                AppIcon(v-if='r.id === editor.recipeId' name='check' :size='16')
              p.builder__hint.builder__hint--tight(v-if='!recipeList.length') Нічого не знайдено — страву можна вписати вручну.

        //- поза прокруткою: на телефоні кнопку видно, навіть коли гортаєш рецепти
        .builder__dialog-actions
          button.btn.btn--primary(type='submit' :disabled='busy') {{ editor.id ? 'Готово' : 'Додати' }}
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

    &--tight {
      margin: -6px 0 0;
      font-size: 13px;
    }
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

    &.is-eaten {
      border-color: $line-green;
      background: $bg-active;
    }

    &.is-missed {
      opacity: 0.6;
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

  &__linked {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: $green-link;
    font-size: 11px;
    font-weight: 700;
  }

  &__recipe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-radius: $radius-item;
    background: $bg-active;
    color: $text-active;

    > span {
      display: flex;
      flex: 1 1 160px;
      flex-direction: column;
    }

    small {
      color: $text-muted;
      font-size: 13px;
    }
  }

  &__book {
    display: flex;
    flex-direction: column;
    gap: 10px;
    grid-column: 2;
    grid-row: 1 / 3;
    min-height: 0;
    padding: 22px;
    border-left: 1px solid $line;
    background: $bg-soft;

    @media (max-width: $bp-md) {
      flex: none;
      border-top: 1px solid $line;
      border-left: 0;
    }
  }

  // Рецепти | Продукти
  &__tabs {
    display: flex;
    flex: none;
    gap: 4px;
    padding: 4px;
    border-radius: $pill;
    background: $bg-tint;

    button {
      flex: 1;
      min-height: 36px;
      padding: 6px 12px;
      border: 0;
      border-radius: $pill;
      background: none;
      color: $text-nav;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;

      &:hover {
        color: $text;
      }

      &:focus-visible {
        outline: 2px solid $accent;
        outline-offset: 1px;
      }

      &.is-on {
        background: $bg;
        color: $text-active;
        box-shadow: 0 1px 3px rgba(20, 38, 27, 0.12);
      }
    }
  }

  // продукти з грамовкою в клітинці: «Гречка — 60 г · Огірок — 150 г»; склад рецепта — у три рядки
  &__products {
    display: -webkit-box;
    overflow: hidden;
    color: $text-muted;
    font-size: 12px;
    line-height: 1.35;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
  }

  // «Зберегти як рецепт»
  &__save-as {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    border: 1px solid $line-green;
    border-radius: $radius-item;
    background: $bg-soft;
  }

  &__save-as-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  &__save-as-open {
    align-self: flex-start;
    gap: 6px;
  }

  // підзаголовок у списку справа: «Просто крупа…», «Рецепти»
  &__group {
    flex: none;
    margin: 6px 2px 2px;
    color: $text-faint;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;

    &:first-child {
      margin-top: 0;
    }
  }

  &__book-search input {
    width: 100%;
    min-height: 42px;
    padding: 9px 14px;
    border: 1px solid $line-green;
    border-radius: $pill;
    background: $bg;
    font: inherit;
    font-size: 14px;

    &:focus {
      border-color: $accent;
      outline: none;
    }
  }

  &__recipe-actions {
    display: flex;
    gap: 6px;
  }

  &__cats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;

    button {
      flex: none;
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

  &__list {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-height: 0;
    padding: 2px;
    overflow-y: auto;

    @media (max-width: $bp-md) {
      flex: none;
      max-height: 45vh;
    }

    button {
      display: flex;
      flex: none;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid $line;
      border-radius: 12px;
      background: $bg;
      color: $text;
      font: inherit;
      font-size: 14px;
      text-align: left;
      cursor: pointer;

      b {
        flex: 1;
        font-weight: 600;
      }

      &:hover,
      &:focus-visible {
        border-color: $accent;
        outline: none;
      }

      &.is-on {
        border-color: $accent;
        background: $bg-active;
        color: $text-active;

        .icon {
          flex: none;
          color: $accent;
        }
      }
    }

    small {
      flex: none;
      color: $text-faint;
      font-size: 12px;
    }
  }

  &__time {
    color: $text-faint;
    font-size: 12px;
    font-weight: 700;
  }

  &__eaten {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: $text-active;
    font-size: 12px;
    font-weight: 700;
  }

  &__legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    margin-bottom: 12px;
    color: $text-muted;
    font-size: 13px;

    span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    b {
      margin-left: auto;
      color: $text;
    }
  }

  &__dot {
    width: 14px;
    height: 14px;
    border-radius: 4px;

    &.is-eaten {
      background: $bg-active;
      box-shadow: inset 0 0 0 2px $line-green;
    }

    &.is-missed {
      background: $bg-soft;
      opacity: 0.6;
      box-shadow: inset 0 0 0 1px $line;
    }
  }

  &__total-eaten {
    display: block;
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
    width: 100%;
    max-width: 440px;
    max-height: calc(100vh - 32px);
    overflow: hidden;
    border-radius: $radius-card;
    background: $bg;

    @media (max-width: $bp-md) {
      max-width: none;
      max-height: 92vh;
      overflow-y: auto;
      border-radius: $radius-card $radius-card 0 0;
    }

    // з базою рецептів: форма зліва, рецепти справа
    &--wide {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      grid-template-rows: minmax(0, 1fr) auto;
      max-width: 920px;
      height: min(620px, calc(100vh - 32px));

      @media (max-width: $bp-md) {
        display: flex;
        height: auto;
      }
    }
  }

  &__dialog-main {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px;
    overflow-y: auto;

    @media (max-width: $bp-md) {
      flex: none;
      overflow: visible;
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
    padding: 14px 22px;
    border-top: 1px solid $line;
    background: $bg;

    @media (max-width: $bp-md) {
      position: sticky;
      bottom: 0;
      padding-bottom: calc(14px + env(safe-area-inset-bottom));
    }
  }

  // панель чернетки: прилипає до низу, поки меню на екрані
  &__bar-text {
    display: flex;
    flex: 1 1 220px;
    flex-direction: column;
    min-width: 0;
  }

  &__cell.is-changed {
    border-color: $accent;
  }

  &__bar {
    position: sticky;
    bottom: 12px;
    z-index: 10;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    margin-top: 12px;
    padding: 10px 12px 10px 16px;
    border: 1px solid $line-green;
    border-radius: $radius-card;
    background: $bg;
    box-shadow: 0 8px 24px rgba(20, 38, 27, 0.14);

    @media (max-width: $bp-sidebar) {
      bottom: calc(64px + env(safe-area-inset-bottom) + 10px);
    }

    b {
      color: $text;
      font-size: 14px;
    }

    small {
      color: $text-muted;
      font-size: 12px;
    }
  }
}

.builder-bar-enter-active,
.builder-bar-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.builder-bar-enter-from,
.builder-bar-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .builder-bar-enter-active,
  .builder-bar-leave-active {
    transition: none;
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
