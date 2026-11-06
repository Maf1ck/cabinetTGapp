// Сповіщення в Telegram від бота — клієнтам і Анастасії.
//
// Події приходять із кабінету (api/notify.ts) і щоранку з крону (api/cron/daily.ts).
// Сервер сам перевіряє, що подія справді сталася, і веде журнал notification_log:
// одне й те саме повідомлення не піде двічі, навіть якщо кабінет надішле подію повторно.
import { Api, InlineKeyboard } from 'grammy'
import type { SupabaseClient } from '@supabase/supabase-js'
import { appUrl, env } from './env.js'

export const TZ = 'Europe/Kyiv'

// ---------------------------------------------------------------- формат (чиста логіка, тестується)

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('uk-UA', { timeZone: TZ, ...o })
const dayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long' })
const dayShort = fmt({ day: 'numeric', month: 'long' })
const clock = fmt({ hour: '2-digit', minute: '2-digit' })
const ymd = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' })

/** «2026-11-05» за київським часом (Vercel живе в UTC) */
export function kyivDate(d: Date): string {
  const p = Object.fromEntries(ymd.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const when = (iso: string) => `${dayLong.format(new Date(iso))}, ${clock.format(new Date(iso))}`
const quote = (s: string, max = 300) => escapeHtml(s.length > max ? `${s.slice(0, max - 1)}…` : s)

// «ваш обід» / «вашу вечерю» — для клієнта; називний — у заголовку для нутриціолога
const MEAL_NOM: Record<string, string> = {
  breakfast: 'сніданок',
  snack1: 'перекус',
  lunch: 'обід',
  snack2: 'другий перекус',
  dinner: 'вечеря',
}

const MEAL: Record<string, string> = {
  breakfast: 'сніданок',
  snack1: 'перекус',
  lunch: 'обід',
  snack2: 'другий перекус',
  dinner: 'вечерю',
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full

export const texts = {
  menuPublished(weekStart: string) {
    const from = new Date(`${weekStart}T12:00:00Z`)
    const to = new Date(from.getTime() + 6 * 86_400_000)
    return `🌿 <b>Ваше меню готове</b>\nТиждень ${dayShort.format(from)} — ${dayShort.format(to)}. Рецепти — одним дотиком у кабінеті.`
  },

  menuUpdated(weekStart: string) {
    const from = new Date(`${weekStart}T12:00:00Z`)
    const to = new Date(from.getTime() + 6 * 86_400_000)
    return `🌿 <b>Анастасія оновила ваше меню</b>\nТиждень ${dayShort.format(from)} — ${dayShort.format(to)}. Подивіться зміни в кабінеті.`
  },

  comment(meal: string | null, body: string) {
    const about = meal && MEAL[meal] ? `${meal === 'dinner' ? 'вашу' : 'ваш'} ${MEAL[meal]}` : 'ваш запис у щоденнику'
    return `💬 <b>Анастасія прокоментувала ${about}</b>\n«${quote(body)}»`
  },

  appointment(a: { starts_at: string; kind: string; zoom_url: string | null }, moved: boolean) {
    const head = moved ? '🗓 <b>Консультацію перенесено</b>' : '🗓 <b>Вас записано на консультацію</b>'
    const zoom = a.zoom_url ? `\nПосилання: ${escapeHtml(a.zoom_url)}` : ''
    return `${head}\n${cap(when(a.starts_at))} · ${escapeHtml(a.kind)}${zoom}`
  },

  cancelled(a: { starts_at: string }) {
    return `🗓 <b>Консультацію скасовано</b>\n${cap(when(a.starts_at))}. Анастасія напише, коли можна перезаписатися.`
  },

  reminder(a: { starts_at: string; kind: string; zoom_url: string | null }) {
    const zoom = a.zoom_url ? `\nПосилання: ${escapeHtml(a.zoom_url)}` : ''
    return `⏰ <b>Сьогодні о ${clock.format(new Date(a.starts_at))} консультація</b>\n${escapeHtml(a.kind)}${zoom}`
  },

  diaryEntry(client: string, e: { meal: string | null; note: string | null; hunger: number | null; fullness: number | null; mood: string | null }) {
    const meal = e.meal && MEAL_NOM[e.meal] ? MEAL_NOM[e.meal] : 'запис'
    const feel = [
      e.hunger ? `голод ${e.hunger}/5` : null,
      e.fullness ? `ситість ${e.fullness}/5` : null,
      e.mood ? escapeHtml(e.mood.toLowerCase()) : null,
    ].filter(Boolean)
    return [
      `📸 <b>${escapeHtml(client)}</b> · ${meal}`,
      e.note ? `«${quote(e.note)}»` : null,
      feel.length ? feel.join(' · ') : null,
    ]
      .filter(Boolean)
      .join('\n')
  },

  labFile(client: string, title: string) {
    return `🧪 <b>${escapeHtml(client)}</b> додав(-ла) аналізи: «${quote(title, 120)}»`
  },

  joined(client: string) {
    return `✅ <b>${escapeHtml(client)}</b> підключився(-лася) до кабінету.`
  },

  digest(d: {
    appointments: { starts_at: string; client: string; kind: string }[]
    unseen: number
    silent: { name: string; days: number | null }[]
  }) {
    const lines = ['☀️ <b>Доброго ранку! План на сьогодні</b>']
    if (d.appointments.length) {
      lines.push('', '<b>Консультації</b>')
      for (const a of d.appointments)
        lines.push(`${clock.format(new Date(a.starts_at))} — ${escapeHtml(a.client)} · ${escapeHtml(a.kind)}`)
    } else lines.push('', 'Консультацій сьогодні немає.')
    if (d.unseen) lines.push('', `📸 Непереглянутих записів у щоденниках: <b>${d.unseen}</b>`)
    if (d.silent.length) {
      lines.push('', '<b>Давно не писали в щоденник</b>')
      for (const s of d.silent) lines.push(`${escapeHtml(s.name)} — ${s.days === null ? 'понад місяць' : `${s.days} дн.`}`)
    }
    return lines.join('\n')
  },
}

// ---------------------------------------------------------------- надсилання

let api: Api | undefined
const bot = () => (api ??= new Api(env('TELEGRAM_BOT_TOKEN')))

// Кнопка Mini App лише з https; локально (http://localhost) — без кнопки
function button(path: string | undefined, label: string): InlineKeyboard | undefined {
  if (!path) return undefined
  try {
    const url = appUrl()
    return url.startsWith('https://') ? new InlineKeyboard().webApp(label, `${url}${path}`) : undefined
  } catch {
    return undefined
  }
}

export interface Message {
  text: string
  /** шлях у кабінеті для кнопки, напр. /c/menu */
  path?: string
  label?: string
  photoUrl?: string | null
}

export async function sendTo(chatId: number, m: Message): Promise<void> {
  const reply_markup = button(m.path, m.label ?? 'Відкрити кабінет')
  if (m.photoUrl) {
    try {
      await bot().sendPhoto(chatId, m.photoUrl, { caption: m.text, parse_mode: 'HTML', reply_markup })
      return
    } catch {
      // фото не завантажилось — надішлемо хоча б текст
    }
  }
  await bot().sendMessage(chatId, m.text, {
    parse_mode: 'HTML',
    reply_markup,
    link_preview_options: { is_disabled: true },
  })
}

export type SendResult = 'sent' | 'duplicate' | 'failed'

/**
 * Надсилає один раз на ключ. Спершу записуємо ключ (унікальний), потім шлемо;
 * не вдалося надіслати — ключ прибираємо, щоб наступна спроба пройшла.
 */
export async function sendOnce(sb: SupabaseClient, key: string, chatId: number, m: Message): Promise<SendResult> {
  const { error } = await sb.from('notification_log').insert({ key })
  if (error) {
    if (error.code === '23505') return 'duplicate'
    throw error
  }
  try {
    await sendTo(chatId, m)
    return 'sent'
  } catch (e) {
    await sb.from('notification_log').delete().eq('key', key)
    // 403: людина зупинила бота — це не збій кабінету
    console.error(`notify ${key}:`, (e as Error).message)
    return 'failed'
  }
}

/** Telegram id клієнта; null — ще не приєднався або доступ вимкнено. */
export async function clientChat(sb: SupabaseClient, clientId: string): Promise<{ chatId: number; name: string } | null> {
  const { data } = await sb
    .from('clients')
    .select('full_name, active, user:users(telegram_id)')
    .eq('id', clientId)
    .maybeSingle()
  const row = data as { full_name: string; active: boolean; user: { telegram_id: number } | null } | null
  if (!row?.active || !row.user) return null
  return { chatId: Number(row.user.telegram_id), name: row.full_name }
}
