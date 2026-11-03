// Хто і як потрапляє в кабінет. Працює з service role (в обхід RLS), тому живе лише на сервері.
//
// Сесії видає Supabase Auth: для кожного користувача Telegram є «тихий» акаунт auth.users
// з технічною поштою tg<id>@telegram.invalid, без пароля. Пошта нікуди не надсилається;
// сесію сервер бере сам (generateLink → verifyOtp), лише після перевірки Telegram.
import { randomBytes } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'
import type { TgUser } from './telegram.js'

export const LOGIN_TTL_MIN = 10
export const INVITE_TTL_DAYS = 7

const noPersist = { auth: { persistSession: false, autoRefreshToken: false } }

export const db = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), noPersist)

export const randomCode = (bytes: number) => randomBytes(bytes).toString('base64url')

export type AppRole = 'client' | 'nutri'

export interface Account {
  userId: string
  telegramId: number
  role: AppRole
  firstName: string | null
  clientId: string | null
}

export interface SessionTokens {
  access_token: string
  refresh_token: string
}

const techEmail = (telegramId: number) => `tg${telegramId}@telegram.invalid`

// undefined-поля supabase-js не надсилає, тож порожні дані з Telegram не затирають збережені
const profileOf = (tg: TgUser) => ({ first_name: tg.first_name, username: tg.username })

async function createAuthUser(sb: SupabaseClient, tg: TgUser): Promise<string> {
  const email = techEmail(tg.id)
  const { data, error } = await sb.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { telegram_id: tg.id },
  })
  if (data.user) return data.user.id
  if (error?.code !== 'email_exists') throw error
  // Акаунт Auth лишився з попередньої спроби: беремо його id
  const { data: link, error: le } = await sb.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw le
  return link.user.id
}

async function insertUser(sb: SupabaseClient, tg: TgUser, role: AppRole) {
  const id = await createAuthUser(sb, tg)
  const { data, error } = await sb
    .from('users')
    .insert({ id, telegram_id: tg.id, role, ...profileOf(tg) })
    .select('id, role, first_name')
    .single()
  if (error) throw error
  return data
}

/**
 * Доступ мають лише Анастасія (OWNER_TG_ID, роль nutri призначається автоматично)
 * і клієнти, які прийняли запрошення і чия картка активна. Реєстрації немає.
 */
export async function resolveAccount(
  sb: SupabaseClient,
  tg: TgUser,
  ownerId: number,
): Promise<Account | null> {
  // Нутриціолог лише один: той, чий ID зараз в OWNER_TG_ID. Якщо його змінили (тести),
  // попередній власник втрачає права одразу: RLS дивиться на users.role, а не на сесію.
  const { error: de } = await sb
    .from('users')
    .update({ role: 'client' })
    .eq('role', 'nutri')
    .neq('telegram_id', ownerId)
  if (de) throw de

  const { data: found, error } = await sb
    .from('users')
    .select('id, role, first_name')
    .eq('telegram_id', tg.id)
    .maybeSingle()
  if (error) throw error

  if (tg.id === ownerId) {
    const user = found ?? (await insertUser(sb, tg, 'nutri'))
    const { error: ue } = await sb
      .from('users')
      .update({ role: 'nutri', ...profileOf(tg) })
      .eq('id', user.id)
    if (ue) throw ue
    return {
      userId: user.id,
      telegramId: tg.id,
      role: 'nutri',
      firstName: tg.first_name ?? user.first_name,
      clientId: null,
    }
  }

  if (!found) return null
  const { data: client, error: ce } = await sb
    .from('clients')
    .select('id, active')
    .eq('user_id', found.id)
    .maybeSingle()
  if (ce) throw ce
  if (!client?.active) return null

  if (tg.first_name || tg.username) await sb.from('users').update(profileOf(tg)).eq('id', found.id)
  return {
    userId: found.id,
    telegramId: tg.id,
    role: 'client',
    firstName: tg.first_name ?? found.first_name,
    clientId: client.id,
  }
}

/** Сесія Supabase Auth для вже перевіреного користувача. */
export async function issueSession(sb: SupabaseClient, telegramId: number): Promise<SessionTokens> {
  const { data, error } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: techEmail(telegramId),
  })
  if (error) throw error
  const anon = createClient(env('SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), noPersist)
  const { data: verified, error: ve } = await anon.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: 'magiclink',
  })
  if (ve) throw ve
  if (!verified.session) throw new Error('Supabase не видав сесію')
  const { access_token, refresh_token } = verified.session
  return { access_token, refresh_token }
}

export async function sessionResponse(sb: SupabaseClient, account: Account): Promise<Response> {
  return Response.json({ session: await issueSession(sb, account.telegramId), account })
}

/** Хто стоїть за access token сайту; null, якщо токен недійсний або доступ відкликано. */
export async function accountFromToken(
  sb: SupabaseClient,
  token: string,
  ownerId: number,
): Promise<Account | null> {
  if (!token) return null
  const { data, error } = await sb.auth.getUser(token)
  if (error || !data.user) return null
  const { data: user } = await sb.from('users').select('telegram_id').eq('id', data.user.id).maybeSingle()
  if (!user) return null
  return resolveAccount(sb, { id: Number(user.telegram_id) }, ownerId)
}

// ---------------------------------------------------------------- вхід з браузера

export async function createLoginToken(sb: SupabaseClient): Promise<string> {
  const token = randomCode(18)
  const expires = new Date(Date.now() + LOGIN_TTL_MIN * 60_000).toISOString()
  const { error } = await sb.from('login_tokens').insert({ token, expires_at: expires })
  if (error) throw error
  // Прибираємо мертві токени заодно, окремий крон для цього не потрібен
  await sb.from('login_tokens').delete().lt('expires_at', new Date(Date.now() - 86_400_000).toISOString())
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
    userId = (await insertUser(sb, tg, 'client')).id
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
