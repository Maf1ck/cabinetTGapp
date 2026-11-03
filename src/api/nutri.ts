// Дані робочого кабінету нутриціолога. RLS пускає is_nutri() до всіх клієнтів.
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import type { MealType } from '@/lib/meals'
import { must, type Wellbeing } from './client'

export interface ClientRow {
  id: string
  full_name: string
  goal: string | null
  program_title: string | null
  program_week: number | null
  program_weeks: number | null
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
  client: { id: string; full_name: string } | null
}

const CLIENT_FIELDS = 'id, full_name, goal, program_title, program_week, program_weeks, active, user_id, created_at'

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

export async function listUnseenDiary(limit = 6): Promise<DiaryItem[]> {
  const rows = must(
    await supabase()
      .from('diary_entries')
      .select('id, meal, note, taken_at, photo_path, client:clients(id, full_name)')
      .eq('seen_by_nutri', false)
      .order('taken_at', { ascending: false })
      .limit(limit),
  ) as unknown as Omit<DiaryItem, 'photoUrl'>[]

  // Фото в приватному бакеті: короткоживучі підписані посилання
  const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p)
  const urls = new Map<string, string>()
  if (paths.length) {
    const { data } = await supabase().storage.from('diary').createSignedUrls(paths, 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }
  return rows.map((r) => ({ ...r, photoUrl: r.photo_path ? (urls.get(r.photo_path) ?? null) : null }))
}

export async function markDiarySeen(id: string): Promise<void> {
  must(await supabase().from('diary_entries').update({ seen_by_nutri: true }).eq('id', id))
}

export async function addDiaryComment(entryId: string, authorId: string, body: string): Promise<void> {
  must(await supabase().from('diary_comments').insert({ entry_id: entryId, author_id: authorId, body }))
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
