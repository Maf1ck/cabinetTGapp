// Вхід з Mini App: фронтенд надсилає Telegram.WebApp.initData, сервер перевіряє підпис.
import { db, resolveAccount, sessionResponse } from '../../server/accounts.js'
import { env, ownerTgId } from '../../server/env.js'
import { readBody } from '../../server/http.js'
import { verifyInitData } from '../../server/telegram.js'

export async function POST(req: Request): Promise<Response> {
  const { initData } = await readBody(req)
  if (typeof initData !== 'string') return Response.json({ error: 'bad_init_data' }, { status: 400 })

  const tg = verifyInitData(initData, env('TELEGRAM_BOT_TOKEN'))
  if (!tg) return Response.json({ error: 'bad_init_data' }, { status: 401 })

  const sb = db()
  const account = await resolveAccount(sb, tg, ownerTgId())
  if (!account) return Response.json({ error: 'no_access' }, { status: 403 })

  return sessionResponse(sb, account)
}
