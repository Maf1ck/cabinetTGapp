// @vitest-environment node
import { decodeJwt } from 'jose'
import { describe, expect, it } from 'vitest'
import { issueSession, readSession, SESSION_TTL_SEC } from '../session'

const SECRET = 'super-secret-jwt-key-with-at-least-32-chars'
const USER = '00000000-0000-0000-0000-0000000000b1'

describe('session JWT', () => {
  it('містить те, що потрібно Supabase для RLS', async () => {
    const claims = decodeJwt(await issueSession(USER, 'client', SECRET))
    expect(claims).toMatchObject({ sub: USER, role: 'authenticated', aud: 'authenticated', app_role: 'client' })
    expect(claims.exp! - claims.iat!).toBe(SESSION_TTL_SEC)
  })

  it('читається тим самим секретом', async () => {
    const token = await issueSession(USER, 'nutri', SECRET)
    expect(await readSession(token, SECRET)).toEqual({ userId: USER, appRole: 'nutri' })
  })

  it('не приймає токен з іншим секретом чи сміття', async () => {
    const token = await issueSession(USER, 'nutri', SECRET)
    expect(await readSession(token, SECRET + 'x')).toBeNull()
    expect(await readSession('', SECRET)).toBeNull()
    expect(await readSession('a.b.c', SECRET)).toBeNull()
  })
})
