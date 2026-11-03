// Вхід з браузера через бота:
//   POST → одноразовий токен і посилання t.me/<bot>?start=login_<token>
//   GET ?token=… → сайт опитує, доки користувач не натисне Start у боті
import { claimLogin, createLoginToken, db, sessionResponse } from '../../server/accounts.js'
import { botUsername, ownerTgId } from '../../server/env.js'

export async function POST(): Promise<Response> {
  const token = await createLoginToken(db())
  return Response.json({ token, botUrl: `https://t.me/${botUsername()}?start=login_${token}` })
}

export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[\w-]{8,58}$/.test(token)) return Response.json({ error: 'bad_token' }, { status: 400 })

  const result = await claimLogin(db(), token, ownerTgId())
  if (result === 'pending') return Response.json({ status: 'pending' }, { status: 202 })
  if (result === 'expired') return Response.json({ error: 'expired' }, { status: 410 })
  if (result === 'denied') return Response.json({ error: 'no_access' }, { status: 403 })
  return sessionResponse(result)
}
