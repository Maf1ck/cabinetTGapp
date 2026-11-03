import { jwtVerify, SignJWT } from 'jose'

export type AppRole = 'client' | 'nutri'

export const SESSION_TTL_SEC = 7 * 24 * 60 * 60

const key = (secret: string) => new TextEncoder().encode(secret)

/**
 * JWT, який Supabase приймає як свій: підписаний JWT Secret проєкту,
 * sub = users.id, тож у RLS auth.uid() повертає саме цього користувача.
 * app_role лише для інтерфейсу: права в базі перевіряє is_nutri() за таблицею users.
 */
export function issueSession(userId: string, appRole: AppRole, secret: string): Promise<string> {
  return new SignJWT({ role: 'authenticated', app_role: appRole })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SEC}s`)
    .sign(key(secret))
}

export async function readSession(
  token: string,
  secret: string,
): Promise<{ userId: string; appRole: AppRole } | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      audience: 'authenticated',
    })
    if (!payload.sub) return null
    return { userId: payload.sub, appRole: payload.app_role === 'nutri' ? 'nutri' : 'client' }
  } catch {
    return null
  }
}
