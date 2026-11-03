// Анастасія створює запрошення для картки клієнта: POST { clientId } → посилання для клієнта.
import { accountFromToken, createInvite, db, INVITE_TTL_DAYS } from '../server/accounts.js'
import { botUsername, ownerTgId } from '../server/env.js'
import { bearer, readBody } from '../server/http.js'

export async function POST(req: Request): Promise<Response> {
  const sb = db()
  const me = await accountFromToken(sb, bearer(req), ownerTgId())
  if (!me) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (me.role !== 'nutri') return Response.json({ error: 'forbidden' }, { status: 403 })

  const { clientId } = await readBody(req)
  if (typeof clientId !== 'string') return Response.json({ error: 'client_not_found' }, { status: 404 })
  const { data: client } = await sb.from('clients').select('id, user_id').eq('id', clientId).maybeSingle()
  if (!client) return Response.json({ error: 'client_not_found' }, { status: 404 })
  if (client.user_id) return Response.json({ error: 'already_joined' }, { status: 409 })

  const code = await createInvite(sb, client.id)
  return Response.json({
    link: `https://t.me/${botUsername()}?start=inv_${code}`,
    expiresInDays: INVITE_TTL_DAYS,
  })
}
