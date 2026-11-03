// Сайт при старті перевіряє збережену сесію: чи доступ досі є і з якою роллю.
import { accountFromToken, db } from '../../server/accounts.js'
import { ownerTgId } from '../../server/env.js'
import { bearer } from '../../server/http.js'

export async function GET(req: Request): Promise<Response> {
  const account = await accountFromToken(db(), bearer(req), ownerTgId())
  if (!account) return Response.json({ error: 'no_access' }, { status: 403 })
  return Response.json({ account })
}
