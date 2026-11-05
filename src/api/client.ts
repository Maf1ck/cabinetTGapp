// Дані кабінету клієнта. Доступ обмежує RLS: клієнт бачить і пише лише рядки свого client_id.
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import type { MealType } from '@/lib/meals'
import { notify } from './notify'
import { normalize } from '@/lib/recipes'
import { buildShoppingList, type ShopLine, type ShopRecipe } from '@/lib/shopping'

type Result<T> = { data: T | null; error: unknown }

export function must<T>({ data, error }: Result<T>): T {
  if (error) throw error
  return data as T
}

export interface ClientCard {
  id: string
  full_name: string
  goal: string | null
  program_title: string | null
  program_week: number | null
  program_weeks: number | null
}

export interface Appointment {
  id: string
  starts_at: string
  kind: string
  zoom_url: string | null
}

export interface Meal {
  id: string
  day: number
  meal: MealType
  at_time: string | null
  title: string
  recipe_id: string | null
  eaten: boolean
}

export interface ShoppingItem {
  id: string
  name: string
  amount: string | null
  checked: boolean
  category: string | null
  /** зібрано з рецептів меню; false — клієнт додав сам */
  from_menu: boolean
}

export interface ShoppingList {
  items: ShoppingItem[]
  /** чи є опубліковане меню на цей тиждень */
  hasMenu: boolean
  /** страви меню без рецепта — їх інгредієнтів у списку немає */
  withoutRecipe: string[]
}

export interface Habit {
  id: string
  title: string
  target_per_week: number
  doneDays: string[]
}

export type Wellbeing = Record<'energy' | 'sleep' | 'digestion' | 'mood', number | null>

export async function getClientCard(clientId: string): Promise<ClientCard> {
  return must(
    await supabase()
      .from('clients')
      .select('id, full_name, goal, program_title, program_week, program_weeks')
      .eq('id', clientId)
      .single(),
  )
}

export async function getNextAppointment(clientId: string): Promise<Appointment | null> {
  return must(
    await supabase()
      .from('appointments')
      .select('id, starts_at, kind, zoom_url')
      .eq('client_id', clientId)
      .eq('status', 'planned')
      .gte('starts_at', new Date(Date.now() - 60 * 60_000).toISOString()) // зустріч, що йде зараз, теж показуємо
      .order('starts_at')
      .limit(1)
      .maybeSingle(),
  )
}

// ---------------------------------------------------------------- вода й самопочуття

export async function getWater(clientId: string, day: string): Promise<number> {
  const row = must(
    await supabase().from('water_logs').select('glasses').eq('client_id', clientId).eq('day', day).maybeSingle(),
  ) as { glasses: number } | null
  return row?.glasses ?? 0
}

export async function setWater(clientId: string, day: string, glasses: number): Promise<void> {
  must(await supabase().from('water_logs').upsert({ client_id: clientId, day, glasses }))
}

export async function getWellbeing(clientId: string, day: string): Promise<Wellbeing> {
  const row = must(
    await supabase()
      .from('wellbeing_logs')
      .select('energy, sleep, digestion, mood')
      .eq('client_id', clientId)
      .eq('day', day)
      .maybeSingle(),
  ) as Wellbeing | null
  return row ?? { energy: null, sleep: null, digestion: null, mood: null }
}

export async function setWellbeing(clientId: string, day: string, value: Partial<Wellbeing>): Promise<void> {
  must(await supabase().from('wellbeing_logs').upsert({ client_id: clientId, day, ...value }))
}

// ---------------------------------------------------------------- меню

/** Опубліковане меню тижня (чернетки RLS клієнту не віддає) з відмітками «з'їдено». */
export async function getWeekMenu(clientId: string, weekStart: string): Promise<Meal[] | null> {
  const menu = must(
    await supabase().from('menus').select('id').eq('client_id', clientId).eq('week_start', weekStart).maybeSingle(),
  ) as { id: string } | null
  if (!menu) return null

  const meals = must(
    await supabase()
      .from('menu_meals')
      .select('id, day, meal, at_time, title, recipe_id')
      .eq('menu_id', menu.id)
      .order('day')
      .order('meal'),
  ) as Omit<Meal, 'eaten'>[]
  if (!meals.length) return []

  const checks = must(
    await supabase()
      .from('meal_checks')
      .select('meal_id')
      .in(
        'meal_id',
        meals.map((m) => m.id),
      ),
  ) as { meal_id: string }[]
  const eaten = new Set(checks.map((c) => c.meal_id))
  return meals.map((m) => ({ ...m, eaten: eaten.has(m.id) }))
}

export async function setMealEaten(clientId: string, mealId: string, eaten: boolean): Promise<void> {
  const table = supabase().from('meal_checks')
  must(
    eaten
      ? await table.upsert({ meal_id: mealId, client_id: clientId })
      : await table.delete().eq('meal_id', mealId),
  )
}

// ---------------------------------------------------------------- покупки й звички

const SHOP_FIELDS = 'id, name, amount, checked, category, from_menu'

type RecipeRow = {
  id: string
  servings: string | null
  lines: { name: string; qty_from: number | null; qty_to: number | null; unit: string | null; ingredient: { category: string | null } | null }[]
}

/** Що треба купити за опублікованим меню; null — меню на тиждень ще немає. */
async function linesFromMenu(clientId: string, weekStart: string): Promise<{ lines: ShopLine[]; withoutRecipe: string[] } | null> {
  const menu = must(
    await supabase().from('menus').select('id').eq('client_id', clientId).eq('week_start', weekStart).maybeSingle(),
  ) as { id: string } | null
  if (!menu) return null
  const meals = must(
    await supabase().from('menu_meals').select('title, recipe_id').eq('menu_id', menu.id),
  ) as { title: string; recipe_id: string | null }[]
  const ids = meals.flatMap((m) => (m.recipe_id ? [m.recipe_id] : []))
  const recipes = new Map<string, ShopRecipe>()
  if (ids.length) {
    const rows = must(
      await supabase()
        .from('recipes')
        .select('id, servings, lines:recipe_ingredients(name, qty_from, qty_to, unit, ingredient:ingredients(category))')
        .in('id', [...new Set(ids)]),
    ) as unknown as RecipeRow[]
    for (const r of rows)
      recipes.set(r.id, {
        id: r.id,
        servings: r.servings,
        lines: r.lines.map(({ ingredient, ...l }) => ({ ...l, category: ingredient?.category ?? null })),
      })
  }
  return {
    lines: buildShoppingList(ids, recipes),
    withoutRecipe: [...new Set(meals.filter((m) => !m.recipe_id).map((m) => m.title))],
  }
}

/**
 * Список покупок на тиждень. Рядки «з меню» звіряються з поточним меню: нові додаються,
 * зайві прибираються, кількості оновлюються; відмітки «куплено» і свої пункти клієнта лишаються.
 */
export async function getShoppingList(clientId: string, weekStart: string): Promise<ShoppingList> {
  const table = () => supabase().from('shopping_items')
  const [plan, current] = await Promise.all([
    linesFromMenu(clientId, weekStart),
    table().select(SHOP_FIELDS).eq('client_id', clientId).eq('week_start', weekStart),
  ])
  let items = must(current) as ShoppingItem[]

  if (plan) {
    const have = new Map(items.filter((i) => i.from_menu).map((i) => [normalize(i.name), i]))
    const want = new Map(plan.lines.map((l) => [normalize(l.name), l]))
    const add = plan.lines.filter((l) => !have.has(normalize(l.name)))
    const drop = [...have].filter(([k]) => !want.has(k)).map(([, i]) => i.id)
    const changed = [...have].flatMap(([k, i]) => {
      const l = want.get(k)
      return l && (l.amount !== i.amount || l.category !== i.category) ? [{ id: i.id, amount: l.amount, category: l.category }] : []
    })
    if (add.length)
      must(
        await table().insert(
          add.map((l) => ({ client_id: clientId, week_start: weekStart, name: l.name, amount: l.amount, category: l.category, from_menu: true })),
        ),
      )
    if (drop.length) must(await table().delete().in('id', drop))
    for (const c of changed) must(await table().update({ amount: c.amount, category: c.category }).eq('id', c.id))
    if (add.length || drop.length || changed.length)
      items = must(await table().select(SHOP_FIELDS).eq('client_id', clientId).eq('week_start', weekStart)) as ShoppingItem[]
  }

  items.sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name, 'uk'))
  return { items, hasMenu: !!plan, withoutRecipe: plan?.withoutRecipe ?? [] }
}

export async function getShopping(clientId: string, weekStart: string): Promise<ShoppingItem[]> {
  return (await getShoppingList(clientId, weekStart)).items
}

export async function addShoppingItem(clientId: string, weekStart: string, name: string, amount: string | null): Promise<ShoppingItem> {
  return must(
    await supabase()
      .from('shopping_items')
      .insert({ client_id: clientId, week_start: weekStart, name, amount, from_menu: false })
      .select(SHOP_FIELDS)
      .single(),
  )
}

export async function deleteShoppingItem(id: string): Promise<void> {
  must(await supabase().from('shopping_items').delete().eq('id', id))
}

export async function setShoppingAllChecked(ids: string[], checked: boolean): Promise<void> {
  if (ids.length) must(await supabase().from('shopping_items').update({ checked }).in('id', ids))
}

export async function setShoppingChecked(id: string, checked: boolean): Promise<void> {
  must(await supabase().from('shopping_items').update({ checked }).eq('id', id))
}

export async function getHabitsWeek(clientId: string, weekStart: string, weekEnd: string): Promise<Habit[]> {
  const habits = must(
    await supabase().from('habits').select('id, title, target_per_week').eq('client_id', clientId).order('title'),
  ) as Omit<Habit, 'doneDays'>[]
  if (!habits.length) return []
  const logs = must(
    await supabase()
      .from('habit_logs')
      .select('habit_id, day')
      .in(
        'habit_id',
        habits.map((h) => h.id),
      )
      .gte('day', weekStart)
      .lte('day', weekEnd),
  ) as { habit_id: string; day: string }[]
  return habits.map((h) => ({ ...h, doneDays: logs.filter((l) => l.habit_id === h.id).map((l) => l.day) }))
}

export async function setHabitDone(habitId: string, day: string, done: boolean): Promise<void> {
  const table = supabase().from('habit_logs')
  must(done ? await table.upsert({ habit_id: habitId, day }) : await table.delete().eq('habit_id', habitId).eq('day', day))
}

// ---------------------------------------------------------------- щоденник

/** Дні (YYYY-MM-DD за часом пристрою), коли були записи в щоденнику. */
export async function getDiaryDays(clientId: string, sinceIso: string): Promise<string[]> {
  const rows = must(
    await supabase()
      .from('diary_entries')
      .select('taken_at')
      .eq('client_id', clientId)
      .gte('taken_at', sinceIso)
      .order('taken_at', { ascending: false }),
  ) as { taken_at: string }[]
  return rows.map((r) => isoDate(new Date(r.taken_at)))
}

// ---------------------------------------------------------------- фото-щоденник

export interface DiaryComment {
  id: string
  body: string
  created_at: string
}

export interface DiaryEntry {
  id: string
  meal: MealType | null
  note: string | null
  taken_at: string
  photo_path: string | null
  hunger: number | null
  fullness: number | null
  mood: string | null
  seen_by_nutri: boolean
  comments: DiaryComment[]
  photoUrl: string | null
}

export interface DiaryDraft {
  meal: MealType
  note: string | null
  hunger: number | null
  fullness: number | null
  mood: string | null
  taken_at: string
}

const DIARY_FIELDS =
  'id, meal, note, taken_at, photo_path, hunger, fullness, mood, seen_by_nutri, comments:diary_comments(id, body, created_at)'

/** Підписані посилання на фото з приватного бакета (живуть годину). */
async function withPhotos(rows: Omit<DiaryEntry, 'photoUrl'>[]): Promise<DiaryEntry[]> {
  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p)
  const urls = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase().storage.from('diary').createSignedUrls(paths, 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  return rows.map((r) => ({
    ...r,
    comments: [...(r.comments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
  }))
}

export async function getDiary(clientId: string, from: Date, to: Date): Promise<DiaryEntry[]> {
  const rows = must(
    await supabase()
      .from('diary_entries')
      .select(DIARY_FIELDS)
      .eq('client_id', clientId)
      .gte('taken_at', from.toISOString())
      .lt('taken_at', to.toISOString())
      .order('taken_at'),
  ) as Omit<DiaryEntry, 'photoUrl'>[]
  return withPhotos(rows)
}

export async function addDiaryEntry(clientId: string, draft: DiaryDraft, photo: Blob | null): Promise<DiaryEntry> {
  let photo_path: string | null = null
  if (photo) {
    // перша папка = client_id: саме за нею Storage-політика пускає клієнта
    photo_path = `${clientId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase()
      .storage.from('diary')
      .upload(photo_path, photo, { contentType: photo.type || 'image/jpeg' })
    if (error) throw error
  }
  const { data, error } = await supabase()
    .from('diary_entries')
    .insert({ client_id: clientId, ...draft, photo_path })
    .select(DIARY_FIELDS)
    .single()
  if (error) {
    if (photo_path) await supabase().storage.from('diary').remove([photo_path])
    throw error
  }
  const [entry] = await withPhotos([data as Omit<DiaryEntry, 'photoUrl'>])
  notify('diary_entry', entry!.id)
  return entry!
}

export async function deleteDiaryEntry(entry: Pick<DiaryEntry, 'id' | 'photo_path'>): Promise<void> {
  must(await supabase().from('diary_entries').delete().eq('id', entry.id))
  if (entry.photo_path) await supabase().storage.from('diary').remove([entry.photo_path])
}
