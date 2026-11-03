import { createHmac, timingSafeEqual } from 'node:crypto'

export interface TgUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
}

// initData живе добу: довше Mini App не тримають відкритим
export const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60

/**
 * Перевіряє підпис initData з Telegram.WebApp.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * Повертає користувача або null, якщо підпис підроблений чи дані застарілі.
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  now = Date.now(),
  maxAgeSec = INIT_DATA_MAX_AGE_SEC,
): TgUser | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(dataCheckString).digest()
  const given = Buffer.from(hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null

  try {
    const user = JSON.parse(params.get('user') ?? '')
    return typeof user?.id === 'number' ? user : null
  } catch {
    return null
  }
}

// Параметр /start <payload>: Telegram дозволяє лише A-Z a-z 0-9 _ - і до 64 символів
export type StartPayload =
  | { kind: 'login'; token: string }
  | { kind: 'invite'; code: string }
  | { kind: 'none' }

export function parseStartPayload(payload: string | undefined): StartPayload {
  const p = (payload ?? '').trim()
  const m = /^(login|inv)_([\w-]{8,58})$/.exec(p)
  if (!m) return { kind: 'none' }
  return m[1] === 'login' ? { kind: 'login', token: m[2]! } : { kind: 'invite', code: m[2]! }
}
