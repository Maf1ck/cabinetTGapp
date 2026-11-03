// Бот локально, без деплою: long polling замість вебхука.
//   pnpm bot:dev
// grammY знімає вебхук при старті, тож після тестів на проді знову виконайте pnpm bot:setup <адреса>.
import { createBot } from '../server/bot.js'

const bot = createBot()
process.once('SIGINT', () => bot.stop())
process.once('SIGTERM', () => bot.stop())

await bot.start({
  drop_pending_updates: true, // старі /start, надіслані поки бот мовчав, не обробляємо
  allowed_updates: ['message', 'callback_query'],
  onStart: (me) => console.log(`Бот @${me.username} слухає. Ctrl+C щоб зупинити.`),
})
