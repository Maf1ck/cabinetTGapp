// Дані кабінету клієнта. Доступ обмежує RLS: клієнт бачить і пише лише рядки свого client_id.
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import type { MealType } from '@/lib/meals'

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

export async function getShopping(clientId: string, weekStart: string): Promise<ShoppingItem[]> {
  return must(
    await supabase()
      .from('shopping_items')
      .select('id, name, amount, checked')
      .eq('client_id', clientId)
      .eq('week_start', weekStart)
      .order('checked')
      .order('name'),
  )
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
