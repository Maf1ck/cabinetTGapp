// Кабінет повідомляє про подію: POST { event, id }. Сервер перевіряє, що подія справжня
// і належить тому, хто питає, — і надсилає сповіщення в Telegram (кожне лише раз).
import { accountFromToken, db } from '../server/accounts.js'
import { ownerTgId } from '../server/env.js'
import { bearer, readBody } from '../server/http.js'
import { clientChat, sendOnce, texts, type SendResult } from '../server/notify.js'

const EVENTS = ['menu_published', 'diary_comment', 'diary_entry', 'appointment', 'lab_file'] as const
type Event = (typeof EVENTS)[number]

const ENTRY_BURST = 10

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

interface CommentRow {
  id: string
  body: string
  author_id: string
  entry: { client_id: string; meal: string | null } | null
}

interface EntryRow {
  id: string
  client_id: string
  meal: string | null
  note: string | null
  photo_path: string | null
  hunger: number | null
  fullness: number | null
  mood: string | null
  client: { full_name: string } | null
}

export async function POST(req: Request): Promise<Response> {
  const sb = db()
  const owner = ownerTgId()
  const me = await accountFromToken(sb, bearer(req), owner)
  if (!me) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { event, id } = await readBody(req)
  if (!EVENTS.includes(event as Event) || typeof id !== 'string' || !UUID.test(id))
    return Response.json({ error: 'bad_request' }, { status: 400 })

  // про щоденник і аналізи повідомляє клієнт, про все інше — нутриціолог
  const nutriOnly = event !== 'diary_entry' && event !== 'lab_file'
  if (nutriOnly !== (me.role === 'nutri')) return Response.json({ error: 'forbidden' }, { status: 403 })

  let result: SendResult | 'skipped' = 'skipped'

  if (event === 'menu_published') {
    const { data: m } = await sb.from('menus').select('id, client_id, week_start, published, revision').eq('id', id).maybeSingle()
    const to = m?.published ? await clientChat(sb, m.client_id) : null
    // перша версія — «меню готове», кожна наступна — окреме «оновила»
    const updated = (m?.revision ?? 1) > 1
    if (m && to)
      result = await sendOnce(sb, updated ? `menu:${m.id}:${m.revision}` : `menu:${m.id}`, to.chatId, {
        text: updated ? texts.menuUpdated(m.week_start) : texts.menuPublished(m.week_start),
        path: '/c/menu',
        label: 'Відкрити меню',
      })
  }

  if (event === 'diary_comment') {
    const { data } = await sb
      .from('diary_comments')
      .select('id, body, author_id, entry:diary_entries(client_id, meal)')
      .eq('id', id)
      .maybeSingle()
    const c = data as CommentRow | null
    const to = c?.entry && c.author_id === me.userId ? await clientChat(sb, c.entry.client_id) : null
    if (c?.entry && to)
      result = await sendOnce(sb, `comment:${c.id}`, to.chatId, {
        text: texts.comment(c.entry.meal, c.body),
        path: '/c/diary',
        label: 'Відкрити щоденник',
      })
  }

  if (event === 'appointment') {
    const { data: a } = await sb
      .from('appointments')
      .select('id, client_id, starts_at, kind, zoom_url, status')
      .eq('id', id)
      .maybeSingle()
    const to = a && a.status !== 'done' ? await clientChat(sb, a.client_id) : null
    if (a && to) {
      const at = new Date(a.starts_at).getTime()
      if (a.status === 'cancelled') {
        // скасування минулої зустрічі клієнту вже нецікаве
        if (at > Date.now())
          result = await sendOnce(sb, `appt-cancel:${a.id}:${at}`, to.chatId, { text: texts.cancelled(a) })
      } else if (at > Date.now()) {
        // перше повідомлення про зустріч — «записано», про той самий запис з іншим часом — «перенесено»
        const { count } = await sb
          .from('notification_log')
          .select('key', { count: 'exact', head: true })
          .like('key', `appt:${a.id}:%`)
        result = await sendOnce(sb, `appt:${a.id}:${at}`, to.chatId, {
          text: texts.appointment(a, (count ?? 0) > 0),
          path: '/c',
        })
      }
    }
  }

  if (event === 'diary_entry') {
    const { data } = await sb
      .from('diary_entries')
      .select('id, client_id, meal, note, photo_path, hunger, fullness, mood, client:clients(full_name)')
      .eq('id', id)
      .maybeSingle()
    const entry = data as EntryRow | null
    // не більше ENTRY_BURST сповіщень на годину від одного клієнта — решту видно в кабінеті
    const { count: recent } = entry
      ? await sb
          .from('notification_log')
          .select('key', { count: 'exact', head: true })
          .like('key', `entry:${entry.client_id}:%`)
          .gte('sent_at', new Date(Date.now() - 3600e3).toISOString())
      : { count: 0 }
    if (entry && entry.client_id === me.clientId && (recent ?? 0) < ENTRY_BURST) {
      const photo = entry.photo_path
        ? (await sb.storage.from('diary').createSignedUrl(entry.photo_path, 600)).data?.signedUrl
        : null
      result = await sendOnce(sb, `entry:${entry.client_id}:${entry.id}`, owner, {
        text: texts.diaryEntry(entry.client?.full_name ?? 'Клієнт', entry),
        photoUrl: photo,
        path: '/n',
        label: 'Переглянути',
      })
    }
  }

  if (event === 'lab_file') {
    const { data } = await sb
      .from('lab_files')
      .select('id, client_id, title, client:clients(full_name)')
      .eq('id', id)
      .maybeSingle()
    const lab = data as { id: string; client_id: string; title: string; client: { full_name: string } | null } | null
    if (lab && lab.client_id === me.clientId)
      result = await sendOnce(sb, `lab:${lab.id}`, owner, {
        text: texts.labFile(lab.client?.full_name ?? 'Клієнт', lab.title),
        path: `/n/clients/${lab.client_id}`,
        label: 'Картка клієнта',
      })
  }

  return Response.json({ result })
}
