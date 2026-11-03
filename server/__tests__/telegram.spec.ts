// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseStartPayload, verifyInitData } from '../telegram'

const BOT_TOKEN = '123456:TEST-token'
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0)
const user = { id: 42, first_name: 'Марія', username: 'maria' }

// Підписуємо так само, як Telegram
function sign(fields: Record<string, string>, token = BOT_TOKEN): string {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = createHmac('sha256', secret).update(check).digest('hex')
  return new URLSearchParams({ ...fields, hash }).toString()
}

const fields = (authDate = NOW / 1000) => ({
  auth_date: String(authDate),
  query_id: 'AAH',
  user: JSON.stringify(user),
})

describe('verifyInitData', () => {
  it('приймає справжній підпис і повертає користувача', () => {
    expect(verifyInitData(sign(fields()), BOT_TOKEN, NOW)).toEqual(user)
  })

  it('відхиляє підробленого користувача', () => {
    const forged = sign(fields()).replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":1'))
    expect(verifyInitData(forged, BOT_TOKEN, NOW)).toBeNull()
  })

  it('відхиляє підпис іншим ботом', () => {
    expect(verifyInitData(sign(fields(), '999:other'), BOT_TOKEN, NOW)).toBeNull()
  })

  it('відхиляє дані, старші за добу', () => {
    expect(verifyInitData(sign(fields(NOW / 1000 - 86_401)), BOT_TOKEN, NOW)).toBeNull()
    expect(verifyInitData(sign(fields(NOW / 1000 - 86_000)), BOT_TOKEN, NOW)).toEqual(user)
  })

  it('відхиляє порожні й зламані дані', () => {
    expect(verifyInitData('', BOT_TOKEN, NOW)).toBeNull()
    expect(verifyInitData('hash=zz&user=1', BOT_TOKEN, NOW)).toBeNull()
    expect(verifyInitData(sign({ auth_date: String(NOW / 1000) }), BOT_TOKEN, NOW)).toBeNull()
  })
})

describe('parseStartPayload', () => {
  it('розпізнає вхід і запрошення', () => {
    expect(parseStartPayload('login_abcDEF12-_x')).toEqual({ kind: 'login', token: 'abcDEF12-_x' })
    expect(parseStartPayload('inv_Qw3rTy12')).toEqual({ kind: 'invite', code: 'Qw3rTy12' })
  })

  it('усе інше вважає звичайним /start', () => {
    for (const p of [undefined, '', 'hello', 'login_', 'inv_short', 'login_bad token!', 'x_abcdefgh'])
      expect(parseStartPayload(p)).toEqual({ kind: 'none' })
  })
})
