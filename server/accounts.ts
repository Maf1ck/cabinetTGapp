// Хто і як потрапляє в кабінет. Працює з service role (в обхід RLS), тому живе лише на сервері.
import { randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'
import { issueSession, type AppRole } from './session.js'
import type { TgUser } from './telegram.js'

export const LOGIN_TTL_MIN = 10
export const INVITE_TTL_DAYS = 7

export const db = () =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

export const randomCode = (bytes: number) => randomBytes(bytes).toString('base64url')

export interface Account {
  userId: string
  role: AppRole
  firstName: string | null
  clientId: string | null
}

// undefined-поля supabase-js не надсилає, тож порожні дані з Telegram не затирають збережені
const profileOf = (tg: TgUser) => ({ first_name: tg.first_name, username: tg.username })

/**
 * Доступ мають лише Анастасія (OWNER_TG_ID, роль nutri призначається автоматично)
 * і клієнти, які прийняли запрошення і чия картка активна. Реєстрації немає.
 */
export async function resolveAccount(
  sb: SupabaseClient,
  tg: TgUser,
  ownerId: number,
): Promise<Account | null> {
  if (tg.id === ownerId) {
    const { data, error } = await sb
      .from('users')
      .upsert({ telegram_id: tg.id, role: 'nutri', ...profileOf(tg) }, { onConflict: 'telegram_id' })
      .select('id, first_name')
      .single()
    if (error) throw error
    return { userId: data.id, role: 'nutri', firstName: data.first_name, clientId: null }
  }

  const { data: user, error } = await sb
    .from('users')
    .select('id, role, first_name')
    .eq('telegram_id', tg.id)
    .maybeSingle()
  if (error) throw error
  if (!user) return null

  let clientId: string | null = null
  if (user.role === 'client') {
    const { data: client, error: e } = await sb
      .from('clients')
      .select('id, active')
      .eq('user_id', user.id)
      .maybeSingle()
    if (e) throw e
    if (!client?.active) return null
    clientId = client.id
  }

  if (tg.first_name || tg.username) await sb.from('users').update(profileOf(tg)).eq('id', user.id)
  return {
    userId: user.id,
    role: user.role,
    firstName: tg.first_name ?? user.first_name,
    clientId,
  }
}

export async function sessionResponse(account: Account): Promise<Response> {
  const token = await issueSession(account.userId, account.role, env('SUPABASE_JWT_SECRET'))
  return Response.json({ token, account })
}

// ---------------------------------------------------------------- вхід з браузера

export async function createLoginToken(sb: SupabaseClient): Promise<string> {
  const token = randomCode(18)
  const expires = new Date(Date.now() + LOGIN_TTL_MIN * 60_000).toISOString()
  const { error } = await sb.from('login_tokens').insert({ token, expires_at: expires })
  if (error) throw error
  return token
}

/** Бот: користувач натиснув Start за посиланням login_<token>. */
export async function confirmLogin(
  sb: SupabaseClient,
  tg: TgUser,
  token: string,
  ownerId: number,
): Promise<'ok' | 'denied' | 'expired'> {
  if (!(await resolveAccount(sb, tg, ownerId))) return 'denied'
  const { data, error } = await sb
    .from('login_tokens')
    .update({ telegram_id: tg.id })
    .eq('token', token)
    .is('telegram_id', null)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('token')
  if (error) throw error
  return data.length ? 'ok' : 'expired'
}

/** Сайт: опитує, чи підтвердив користувач вхід у боті. Токен одноразовий. */
export async function claimLogin(
  sb: SupabaseClient,
  token: string,
  ownerId: number,
): Promise<Account | 'pending' | 'expired' | 'denied'> {
  const { data, error } = await sb
    .from('login_tokens')
    .update({ consumed_at: new Date().toISOString() })
    .eq('token', token)
    .not('telegram_id', 'is', null)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('telegram_id')
  if (error) throw error

  const claimed = data[0]
  if (claimed) return (await resolveAccount(sb, { id: Number(claimed.telegram_id) }, ownerId)) ?? 'denied'

  const { data: row } = await sb
    .from('login_tokens')
    .select('telegram_id, expires_at, consumed_at')
    .eq('token', token)
    .maybeSingle()
  const alive = row && !row.consumed_at && new Date(row.expires_at) > new Date()
  return alive && row.telegram_id === null ? 'pending' : 'expired'
}

// ---------------------------------------------------------------- запрошення

export async function createInvite(sb: SupabaseClient, clientId: string): Promise<string> {
  const code = randomCode(12)
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString()
  const { error } = await sb.from('invites').insert({ code, client_id: clientId, expires_at: expires })
  if (error) throw error
  return code
}

export type InviteResult =
  | { ok: true; fullName: string }
  | { ok: false; reason: 'invalid' | 'owner' | 'taken' | 'already_client' }

/** Бот: клієнт відкрив t.me/<bot>?start=inv_<code>. */
export async function acceptInvite(
  sb: SupabaseClient,
  tg: TgUser,
  code: string,
  ownerId: number,
): Promise<InviteResult> {
  if (tg.id === ownerId) return { ok: false, reason: 'owner' }

  const { data: invite } = await sb
    .from('invites')
    .select('client_id, expires_at, used_at')
    .eq('code', code)
    .maybeSingle()
  if (!invite || invite.used_at || new Date(invite.expires_at) < new Date())
    return { ok: false, reason: 'invalid' }

  const { data: client } = await sb
    .from('clients')
    .select('id, user_id, full_name')
    .eq('id', invite.client_id)
    .single()
  if (!client) return { ok: false, reason: 'invalid' }
  if (client.user_id) return { ok: false, reason: 'taken' }

  // Користувач: уже існує (наприклад, колишній клієнт) або новий
  const { data: existing } = await sb
    .from('users')
    .select('id, role')
    .eq('telegram_id', tg.id)
    .maybeSingle()
  let userId: string
  if (existing) {
    if (existing.role !== 'client') return { ok: false, reason: 'owner' }
    const { data: linked } = await sb.from('clients').select('id').eq('user_id', existing.id).maybeSingle()
    if (linked) return { ok: false, reason: 'already_client' }
    userId = existing.id
  } else {
    const { data: created, error } = await sb
      .from('users')
      .insert({ telegram_id: tg.id, role: 'client', ...profileOf(tg) })
      .select('id')
      .single()
    if (error) throw error
    userId = created.id
  }

  // Запрошення гаситься атомарно: два одночасні кліки не прив'яжуть два акаунти
  const { data: used, error: ue } = await sb
    .from('invites')
    .update({ used_at: new Date().toISOString() })
    .eq('code', code)
    .is('used_at', null)
    .select('code')
  if (ue) throw ue
  if (!used.length) return { ok: false, reason: 'invalid' }

  const { data: bound, error: be } = await sb
    .from('clients')
    .update({ user_id: userId })
    .eq('id', client.id)
    .is('user_id', null)
    .select('id')
  if (be) throw be
  if (!bound.length) return { ok: false, reason: 'taken' }

  return { ok: true, fullName: client.full_name }
}
