// Вебхук Telegram. Реєструється один раз: pnpm bot:setup <адреса кабінету>
import { webhookCallback } from 'grammy'
import { createBot } from '../server/bot.js'
import { env } from '../server/env.js'

let handler: ((req: Request) => Promise<Response>) | undefined

export function POST(req: Request): Promise<Response> {
  // secretToken: grammY відхиляє запити без заголовка X-Telegram-Bot-Api-Secret-Token
  handler ??= webhookCallback(createBot(), 'std/http', {
    secretToken: env('TELEGRAM_WEBHOOK_SECRET'),
  })
  return handler(req)
}
