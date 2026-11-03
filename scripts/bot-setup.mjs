// Реєструє вебхук і кнопку «Кабінет» у меню бота. Запускати після деплою:
//   pnpm bot:setup https://<адреса-кабінету>
// Бере TELEGRAM_BOT_TOKEN і TELEGRAM_WEBHOOK_SECRET з .env
const url = process.argv[2]?.replace(/\/$/, '')
const token = process.env.TELEGRAM_BOT_TOKEN
const secret = process.env.TELEGRAM_WEBHOOK_SECRET

if (!url?.startsWith('https://')) throw new Error('Вкажіть адресу кабінету: pnpm bot:setup https://…')
if (!token || !secret) throw new Error('У .env немає TELEGRAM_BOT_TOKEN або TELEGRAM_WEBHOOK_SECRET')

const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(`${method}: ${json.description}`)
  console.log('  ok ', method)
}

await call('setWebhook', {
  url: `${url}/api/bot`,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: true,
})
await call('setChatMenuButton', {
  menu_button: { type: 'web_app', text: 'Кабінет', web_app: { url } },
})
await call('setMyCommands', { commands: [{ command: 'start', description: 'Відкрити кабінет' }] })
console.log('\nБот налаштований. Напишіть йому /start')
