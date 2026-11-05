// Щоранку (vercel.json → crons, 06:00 UTC ≈ 8:00 за Києвом взимку):
// нагадування клієнтам про сьогоднішні консультації і ранковий підсумок для Анастасії.
// Vercel сам додає заголовок Authorization: Bearer $CRON_SECRET.
import { createHash, timingSafeEqual } from 'node:crypto'
import { db } from '../../server/accounts.js'
import { env, ownerTgId } from '../../server/env.js'
import { clientChat, firstName, kyivDate, sendOnce, texts } from '../../server/notify.js'

const SILENT_DAYS = 3

// хеші однакової довжини: timingSafeEqual не видає ні довжину, ні збіг префікса
const sha = (s: string) => createHash('sha256').update(s).digest()
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b))

interface ApptRow {
  id: string
  client_id: string
  starts_at: string
  kind: string
  zoom_url: string | null
  client: { full_name: string } | null
}

export async function GET(req: Request): Promise<Response> {
  if (!sameSecret(req.headers.get('authorization') ?? '', `Bearer ${env('CRON_SECRET')}`))
    return Response.json({ error: 'unauthorized' }, { status: 401 })

  const sb = db()
  const now = new Date()
  const today = kyivDate(now)

  // «сьогодні» за Києвом: беремо з запасом і фільтруємо за київською датою
  const { data: appts, error } = await sb
    .from('appointments')
    .select('id, client_id, starts_at, kind, zoom_url, client:clients(full_name)')
    .eq('status', 'planned')
    .gte('starts_at', new Date(now.getTime() - 12 * 3600e3).toISOString())
    .lt('starts_at', new Date(now.getTime() + 36 * 3600e3).toISOString())
    .order('starts_at')
  if (error) throw error
  const todays = ((appts ?? []) as unknown as ApptRow[]).filter((a) => kyivDate(new Date(a.starts_at)) === today)

  let reminders = 0
  for (const a of todays) {
    if (new Date(a.starts_at) < now) continue
    const to = await clientChat(sb, a.client_id)
    if (!to) continue
    const r = await sendOnce(sb, `remind:${a.id}:${today}`, to.chatId, { text: texts.reminder(a), path: '/c' })
    if (r === 'sent') reminders++
  }

  // Підсумок для Анастасії
  const { count: unseen } = await sb
    .from('diary_entries')
    .select('id', { count: 'exact', head: true })
    .eq('seen_by_nutri', false)
  const { data: clients } = await sb.from('clients').select('id, full_name').eq('active', true).not('user_id', 'is', null)
  const { data: recent } = await sb
    .from('diary_entries')
    .select('client_id, taken_at')
    .gte('taken_at', new Date(now.getTime() - 30 * 86_400_000).toISOString())
    .order('taken_at', { ascending: false })
  const last = new Map<string, string>()
  for (const r of recent ?? []) if (!last.has(r.client_id)) last.set(r.client_id, r.taken_at)
  const silent = (clients ?? []).flatMap((c) => {
    const t = last.get(c.id)
    // null — за останній місяць жодного запису
    const days = t ? Math.floor((now.getTime() - new Date(t).getTime()) / 86_400_000) : null
    return days === null || days >= SILENT_DAYS ? [{ name: firstName(c.full_name), days }] : []
  })

  const digest = await sendOnce(sb, `digest:${today}`, ownerTgId(), {
    text: texts.digest({
      appointments: todays.map((a) => ({ starts_at: a.starts_at, kind: a.kind, client: a.client?.full_name ?? 'Клієнт' })),
      unseen: unseen ?? 0,
      silent,
    }),
    path: '/n',
  })

  return Response.json({ reminders, digest })
}
