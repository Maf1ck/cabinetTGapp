// Лише для `pnpm dev`: виконує api/**/*.ts так само, як Vercel (export GET/POST(Request) → Response),
// щоб не потрібен був `vercel dev`. Серверні змінні беремо з .env.
import { existsSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { loadEnv, type Plugin } from 'vite'

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0
  return new Request(new URL(req.url!, origin), {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  })
}

export function devApi(): Plugin {
  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      // loadEnv віддає перевагу тому, що вже є в process.env, тож після правки .env
      // спершу прибираємо значення, записані попереднім запуском (Vite перезапускається сам)
      const g = globalThis as { __devApiEnvKeys?: string[] }
      for (const k of g.__devApiEnvKeys ?? []) delete process.env[k]
      const fileEnv = loadEnv(server.config.mode, server.config.root, '')
      const keys = Object.keys(fileEnv).filter((k) => !(k in process.env))
      for (const k of keys) process.env[k] = fileEnv[k]
      g.__devApiEnvKeys = keys

      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (!path.startsWith('/api/')) return next()

        const file = `${server.config.root}/${path.replace(/\/$/, '')}.ts`
        if (!existsSync(file)) {
          res.statusCode = 404
          return res.end()
        }
        try {
          const mod = await server.ssrLoadModule(file)
          const handler = mod[req.method ?? 'GET']
          if (typeof handler !== 'function') {
            res.statusCode = 405
            return res.end()
          }
          const response: Response = await handler(await toRequest(req, `http://${req.headers.host}`))
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          // Повідомлення видно лише локально: зазвичай це «Не задано змінну середовища …»
          // помилки supabase-js приходять звичайними об'єктами { message, code, hint }
          const err = e as { message?: string; code?: string; hint?: string }
          const message = [err.code, err.message ?? String(e), err.hint].filter(Boolean).join(' · ')
          server.config.logger.error(`[api] ${path}: ${message}`)
          if (process.env.DEBUG_API) console.error(e)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'server_error', message }))
        }
      })
    },
  }
}
