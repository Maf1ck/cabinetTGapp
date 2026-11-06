// Дані робочого кабінету нутриціолога. RLS пускає is_nutri() до всіх клієнтів.
import { supabase } from '@/lib/supabase'
import { isoDate, weekday, weekStart } from '@/lib/dates'
import type { MealType } from '@/lib/meals'
import { hasCheck, must, type Wellbeing } from './client'
import { notify } from './notify'

export interface ClientRow {
  id: string
  full_name: string
  goal: string | null
  program_title: string | null
  program_week: number | null
  program_weeks: number | null
  /** на супроводі: «зʼїдено» клієнт ставить лише з фото або коментарем */
  on_support: boolean
  active: boolean
  user_id: string | null
  created_at: string
}

export interface ClientDraft {
  full_name: string
  goal: string | null
  program_title: string | null
  program_week: number | null
  program_weeks: number | null
  on_support: boolean
}

export interface ScheduleItem {
  id: string
  starts_at: string
  kind: string
  note: string | null
  client: { id: string; full_name: string } | null
}

export interface DiaryItem {
  id: string
  meal: MealType | null
  note: string | null
  taken_at: string
  photo_path: string | null
  photoUrl: string | null
  hunger: number | null
  fullness: number | null
  mood: string | null
  seen_by_nutri: boolean
  /** страва меню, про яку звіт (клієнт відмітив її «зʼїдено») */
  menu_meal_id: string | null
  /** скільки коментарів Анастасії вже є */
  comments: number
  client: { id: string; full_name: string } | null
}

export interface DiaryDetails {
  comments: { id: string; body: string; created_at: string }[]
  /** що стояло в меню на цей прийом — щоб порівняти з тим, що на фото */
  planned: { title: string; recipe_id: string | null; eaten: boolean } | null
}

const CLIENT_FIELDS = 'id, full_name, goal, program_title, program_week, program_weeks, on_support, active, user_id, created_at'

export async function listClients(): Promise<ClientRow[]> {
  return must(await supabase().from('clients').select(CLIENT_FIELDS).order('full_name'))
}

export async function createClientCard(draft: ClientDraft): Promise<ClientRow> {
  return must(await supabase().from('clients').insert(draft).select(CLIENT_FIELDS).single())
}

export async function updateClientCard(id: string, patch: Partial<ClientDraft & { active: boolean }>): Promise<ClientRow> {
  return must(await supabase().from('clients').update(patch).eq('id', id).select(CLIENT_FIELDS).single())
}

/** Посилання-запрошення в бота: створює сервер (таблиця invites закрита для браузера). */
export async function createInviteLink(clientId: string): Promise<string> {
  const { data } = await supabase().auth.getSession()
  const res = await fetch('/api/invites', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${data.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ clientId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'invite_failed')
  return body.link
}

export async function getSchedule(from: Date, to: Date): Promise<ScheduleItem[]> {
  return must(
    await supabase()
      .from('appointments')
      .select('id, starts_at, kind, note, client:clients(id, full_name)')
      .eq('status', 'planned')
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString())
      .order('starts_at'),
  ) as unknown as ScheduleItem[]
}

export async function nextAppointments(clientId: string): Promise<ScheduleItem | null> {
  return must(
    await supabase()
      .from('appointments')
      .select('id, starts_at, kind, note, client:clients(id, full_name)')
      .eq('client_id', clientId)
      .eq('status', 'planned')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at')
      .limit(1)
      .maybeSingle(),
  ) as unknown as ScheduleItem | null
}

export async function countUnseenDiary(): Promise<number> {
  const { count, error } = await supabase()
    .from('diary_entries')
    .select('id', { count: 'exact', head: true })
    .eq('seen_by_nutri', false)
  if (error) throw error
  return count ?? 0
}

type DiaryRow = Omit<DiaryItem, 'photoUrl' | 'comments'> & { diary_comments: { count: number }[] }

export interface DiaryFilter {
  clientId?: string | null
  unseenOnly?: boolean
  since?: Date
  limit?: number
}

/** Записи щоденників усіх клієнтів (або одного), найновіші першими, з підписаними фото. */
export async function listDiary(f: DiaryFilter = {}): Promise<DiaryItem[]> {
  let q = supabase()
    .from('diary_entries')
    .select(
      'id, meal, note, taken_at, photo_path, hunger, fullness, mood, seen_by_nutri, menu_meal_id, client:clients(id, full_name), diary_comments(count)',
    )
    .order('taken_at', { ascending: false })
    .limit(f.limit ?? 60)
  if (f.clientId) q = q.eq('client_id', f.clientId)
  if (f.unseenOnly) q = q.eq('seen_by_nutri', false)
  if (f.since) q = q.gte('taken_at', f.since.toISOString())
  const rows = must(await q) as unknown as DiaryRow[]

  // Фото в приватному бакеті: короткоживучі підписані посилання
  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p)
  const urls = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase().storage.from('diary').createSignedUrls(paths, 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  return rows.map(({ diary_comments, ...r }) => ({
    ...r,
    comments: diary_comments[0]?.count ?? 0,
    photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null,
  }))
}

export const listUnseenDiary = (limit = 6) => listDiary({ unseenOnly: true, limit })

export async function getDiaryDetails(entry: DiaryItem): Promise<DiaryDetails> {
  const taken = new Date(entry.taken_at)
  // звіт про страву з меню знає її напряму; давніші записи — шукаємо за днем і прийомом їжі
  const linked = entry.menu_meal_id
    ? supabase()
        .from('menu_meals')
        .select('title, recipe_id, meal_checks(meal_id)')
        .eq('id', entry.menu_meal_id)
        .maybeSingle()
    : null
  const [comments, planned] = await Promise.all([
    supabase().from('diary_comments').select('id, body, created_at').eq('entry_id', entry.id).order('created_at'),
    linked ??
    (entry.meal && entry.client
      ? supabase()
          .from('menu_meals')
          .select('title, recipe_id, menus!inner(client_id, week_start), meal_checks(meal_id)')
          .eq('menus.client_id', entry.client.id)
          .eq('menus.week_start', isoDate(weekStart(taken)))
          .eq('day', weekday(taken))
          .eq('meal', entry.meal)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null })),
  ])
  const row = must(planned) as { title: string; recipe_id: string | null; meal_checks: unknown[] | unknown | null } | null
  return {
    comments: must(comments) as DiaryDetails['comments'],
    planned: row
      ? {
          title: row.title,
          recipe_id: row.recipe_id,
          eaten: Array.isArray(row.meal_checks) ? row.meal_checks.length > 0 : !!row.meal_checks,
        }
      : null,
  }
}

export async function markDiarySeen(id: string): Promise<void> {
  must(await supabase().from('diary_entries').update({ seen_by_nutri: true }).eq('id', id))
}

export async function addDiaryComment(entryId: string, authorId: string, body: string): Promise<void> {
  const row = must(
    await supabase().from('diary_comments').insert({ entry_id: entryId, author_id: authorId, body }).select('id').single(),
  ) as { id: string }
  notify('diary_comment', row.id)
}

export async function paidSumSince(since: Date): Promise<number> {
  const rows = must(
    await supabase().from('payments').select('amount_uah').eq('status', 'paid').gte('paid_at', since.toISOString()),
  ) as { amount_uah: number }[]
  return rows.reduce((s, r) => s + r.amount_uah, 0)
}

/** Дні із записами в щоденнику для кожного клієнта (для серій і «N днів без записів»). */
export async function diaryDaysByClient(sinceIso: string): Promise<Map<string, string[]>> {
  const rows = must(
    await supabase()
      .from('diary_entries')
      .select('client_id, taken_at')
      .gte('taken_at', sinceIso)
      .order('taken_at', { ascending: false }),
  ) as { client_id: string; taken_at: string }[]
  const map = new Map<string, string[]>()
  for (const r of rows) {
    const list = map.get(r.client_id) ?? []
    list.push(isoDate(new Date(r.taken_at)))
    map.set(r.client_id, list)
  }
  return map
}

export interface WellbeingDay extends Wellbeing {
  day: string
}

export async function getWellbeingSince(clientId: string, since: string): Promise<WellbeingDay[]> {
  return must(
    await supabase()
      .from('wellbeing_logs')
      .select('day, energy, sleep, digestion, mood')
      .eq('client_id', clientId)
      .gte('day', since)
      .order('day'),
  )
}

// ---------------------------------------------------------------- конструктор меню

export interface EditableMeal {
  id: string
  day: number
  meal: MealType
  at_time: string | null
  title: string
  recipe_id: string | null
  /** клієнт відмітив страву з'їденою */
  eaten: boolean
}

export interface EditableMenu {
  id: string
  published: boolean
  /** робоча версія: чернетка, а якщо її немає, то збережене меню */
  meals: EditableMeal[]
  /** те, що зараз бачить клієнт (або побачив би, якщо меню ще не надіслане) */
  saved: EditableMeal[]
  hasDraft: boolean
}

const MEAL_FIELDS = 'id, day, meal, at_time, title, recipe_id'

/** Меню клієнта на тиждень разом із чернеткою (нутриціолог бачить і неопубліковані). */
export async function getMenuForEdit(clientId: string, weekStart: string): Promise<EditableMenu | null> {
  const menu = must(
    await supabase()
      .from('menus')
      .select('id, published')
      .eq('client_id', clientId)
      .eq('week_start', weekStart)
      .maybeSingle(),
  ) as { id: string; published: boolean } | null
  if (!menu) return null
  const rows = must(
    await supabase()
      .from('menu_meals')
      .select(`${MEAL_FIELDS}, meal_checks(meal_id)`)
      .eq('menu_id', menu.id)
      .order('day')
      .order('meal'),
  ) as (Omit<EditableMeal, 'eaten'> & { meal_checks: unknown })[]
  const saved = rows.map(({ meal_checks, ...m }) => ({ ...m, eaten: hasCheck(meal_checks) }))
  const draft = must(
    await supabase().from('menu_drafts').select('meals').eq('menu_id', menu.id).maybeSingle(),
  ) as { meals: Omit<EditableMeal, 'eaten'>[] } | null
  const eaten = new Set(saved.filter((m) => m.eaten).map((m) => m.id))
  return {
    ...menu,
    saved,
    meals: draft ? draft.meals.map((m) => ({ ...m, eaten: eaten.has(m.id) })) : saved,
    hasDraft: !!draft,
  }
}

/** Меню створюється при першій страві; нове — завжди чернетка. */
export async function ensureMenu(clientId: string, weekStart: string): Promise<EditableMenu> {
  const existing = await getMenuForEdit(clientId, weekStart)
  if (existing) return existing
  const row = must(
    await supabase()
      .from('menus')
      .upsert({ client_id: clientId, week_start: weekStart }, { onConflict: 'client_id,week_start' })
      .select('id, published')
      .single(),
  ) as { id: string; published: boolean }
  return { ...row, meals: [], saved: [], hasDraft: false }
}

/** Чернетка лежить у базі: її видно з будь-якого пристрою, клієнту вона недоступна. */
export async function saveMenuDraft(menuId: string, meals: EditableMeal[]): Promise<void> {
  const clean = meals.map(({ eaten: _eaten, ...m }) => m)
  must(
    await supabase()
      .from('menu_drafts')
      .upsert({ menu_id: menuId, meals: clean, updated_at: new Date().toISOString() }),
  )
}

export async function discardMenuDraft(menuId: string): Promise<void> {
  must(await supabase().from('menu_drafts').delete().eq('menu_id', menuId))
}

/** Застосовує чернетку, показує меню клієнту і надсилає сповіщення. */
export async function publishMenu(menuId: string): Promise<void> {
  must(await supabase().rpc('publish_menu', { p_menu_id: menuId }))
  notify('menu_published', menuId)
}

export async function hideMenu(menuId: string): Promise<void> {
  must(await supabase().from('menus').update({ published: false }).eq('id', menuId))
}

// ---------------------------------------------------------------- календар

export interface CalendarItem {
  id: string
  starts_at: string
  duration_min: number
  kind: string
  status: 'planned' | 'done' | 'cancelled'
  zoom_url: string | null
  note: string | null
  client: { id: string; full_name: string } | null
}

export interface AppointmentDraft {
  client_id: string
  starts_at: string
  duration_min: number
  kind: string
  zoom_url: string | null
  note: string | null
}

const APPT_FIELDS = 'id, starts_at, duration_min, kind, status, zoom_url, note, client:clients(id, full_name)'

export async function getCalendar(from: Date, to: Date): Promise<CalendarItem[]> {
  return must(
    await supabase()
      .from('appointments')
      .select(APPT_FIELDS)
      .neq('status', 'cancelled')
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString())
      .order('starts_at'),
  ) as unknown as CalendarItem[]
}

export async function saveAppointment(draft: AppointmentDraft, id?: string): Promise<CalendarItem> {
  const table = supabase().from('appointments')
  const saved = must(
    id
      ? await table.update(draft).eq('id', id).select(APPT_FIELDS).single()
      : await table.insert(draft).select(APPT_FIELDS).single(),
  ) as unknown as CalendarItem
  notify('appointment', saved.id) // сервер сам розбереться: новий запис, перенесення чи нічого
  return saved
}

export async function setAppointmentStatus(id: string, status: CalendarItem['status']): Promise<void> {
  must(await supabase().from('appointments').update({ status }).eq('id', id))
  if (status === 'cancelled') notify('appointment', id)
}

// ---------------------------------------------------------------- оплати

export type PaymentStatus = 'pending' | 'paid' | 'cancelled'

export interface PaymentRow {
  id: string
  title: string
  amount_uah: number
  status: PaymentStatus
  pay_url: string | null
  created_at: string
  paid_at: string | null
  client: { id: string; full_name: string } | null
}

export interface PaymentDraft {
  client_id: string
  title: string
  amount_uah: number
  status: PaymentStatus
  pay_url: string | null
  paid_at: string | null
}

const PAYMENT_FIELDS = 'id, title, amount_uah, status, pay_url, created_at, paid_at, client:clients(id, full_name)'

/** Оплати, створені або оплачені від `since`, найновіші першими. */
export async function listPayments(since: Date): Promise<PaymentRow[]> {
  const iso = since.toISOString()
  return must(
    await supabase()
      .from('payments')
      .select(PAYMENT_FIELDS)
      .or(`created_at.gte.${iso},paid_at.gte.${iso},status.eq.pending`)
      .order('created_at', { ascending: false }),
  ) as unknown as PaymentRow[]
}

export async function savePayment(draft: PaymentDraft, id?: string): Promise<PaymentRow> {
  const table = supabase().from('payments')
  return must(
    id
      ? await table.update(draft).eq('id', id).select(PAYMENT_FIELDS).single()
      : await table.insert(draft).select(PAYMENT_FIELDS).single(),
  ) as unknown as PaymentRow
}

export async function setPaymentStatus(id: string, status: PaymentStatus): Promise<void> {
  must(
    await supabase()
      .from('payments')
      .update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null })
      .eq('id', id),
  )
}

export async function deletePayment(id: string): Promise<void> {
  must(await supabase().from('payments').delete().eq('id', id))
}
