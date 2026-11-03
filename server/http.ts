// JSON-тіло запиту; зламане чи порожнє стає {}
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null)
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
}

export const bearer = (req: Request) =>
  req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
