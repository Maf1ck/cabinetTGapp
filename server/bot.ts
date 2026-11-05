import { Bot, InlineKeyboard } from 'grammy'
import { acceptInvite, confirmLogin, db, resolveAccount } from './accounts.js'
import { appUrl, env, ownerTgId } from './env.js'
import { sendOnce, texts } from './notify.js'
import { parseStartPayload } from './telegram.js'

const CONTACT = '@nk_1802'

const LOGIN_TEXT = {
  ok: '✅ Вхід підтверджено. Поверніться на сайт: кабінет відкриється сам.',
  expired: 'Посилання для входу застаріло. Натисніть «Увійти» на сайті ще раз.',
  denied: `Кабінет доступний лише клієнтам за запрошенням. Напишіть Анастасії: ${CONTACT}`,
}

// Telegram приймає для Mini App лише https; локально (без APP_URL) кнопки просто немає
function openButton(): InlineKeyboard | undefined {
  try {
    const url = appUrl()
    return url.startsWith('https://') ? new InlineKeyboard().webApp('Відкрити кабінет', url) : undefined
  } catch {
    return undefined
  }
}

export function createBot(): Bot {
  const bot = new Bot(env('TELEGRAM_BOT_TOKEN'))

  bot.command('start', async (ctx) => {
    const from = ctx.from
    if (!from) return
    const sb = db()
    const owner = ownerTgId()
    const payload = parseStartPayload(ctx.match)

    if (payload.kind === 'login') {
      // Не підтверджуємо одразу: інакше чуже посилання login_… віддало б сесію тому, хто його надіслав
      if (!(await resolveAccount(sb, from, owner))) {
        await ctx.reply(LOGIN_TEXT.denied)
        return
      }
      await ctx.reply(
        'Підтвердіть вхід у кабінет на сайті.\n\n⚠️ Якщо ви щойно не натискали «Увійти» на сайті, нічого не натискайте: хтось може намагатися увійти у ваш кабінет.',
        { reply_markup: new InlineKeyboard().text('Так, це я, увійти', `login:${payload.token}`) },
      )
      return
    }

    if (payload.kind === 'invite') {
      const result = await acceptInvite(sb, from, payload.code, owner)
      if (result.ok) {
        // Анастасії — що людина приєдналась (не критично: збій не заважає клієнту)
        await sendOnce(sb, `joined:${from.id}`, owner, { text: texts.joined(result.fullName), path: '/n/clients' }).catch(
          (e: Error) => console.error('notify joined', e.message),
        )
        await ctx.reply(
          `Вітаю, ${result.fullName}! 🌿\nВаш кабінет готовий: меню, щоденник харчування і зв'язок з Анастасією.`,
          { reply_markup: openButton() },
        )
        return
      }
      const text = {
        invalid: `Запрошення недійсне або прострочене. Попросіть Анастасію надіслати нове: ${CONTACT}`,
        taken: 'Це запрошення вже використали. Якщо це були не ви, напишіть Анастасії.',
        already_client: 'Ваш акаунт уже привʼязаний до кабінету.',
        owner: 'Це ваш акаунт нутриціолога: запрошення призначені для клієнтів.',
      }[result.reason]
      await ctx.reply(text, result.reason === 'already_client' ? { reply_markup: openButton() } : {})
      return
    }

    const account = await resolveAccount(sb, from, owner)
    if (account) {
      const button = openButton()
      await ctx.reply(button ? 'Ваш кабінет тут 👇' : 'У вас є доступ до кабінету ✅', { reply_markup: button })
    } else {
      await ctx.reply(
        `Це закритий кабінет клієнтів нутриціолога Анастасії.\nЩоб отримати доступ, напишіть ${CONTACT}`,
      )
    }
  })

  bot.callbackQuery(/^login:([\w-]{8,58})$/, async (ctx) => {
    const result = await confirmLogin(db(), ctx.from, ctx.match[1]!, ownerTgId())
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(LOGIN_TEXT[result])
  })

  bot.catch((err) => console.error('bot error', err.error))
  return bot
}
