import { Bot, InlineKeyboard } from 'grammy'
import { acceptInvite, confirmLogin, db, resolveAccount } from './accounts.js'
import { env, ownerTgIds } from './env.js'
import { cabinetButtons, sendOnceToAll, texts } from './notify.js'
import { parseStartPayload } from './telegram.js'

const CONTACT = '@nk_1802'

const LOGIN_TEXT = {
  ok: '✅ Вхід підтверджено. Поверніться на сайт: кабінет відкриється сам.',
  expired: 'Посилання для входу застаріло. Натисніть «Увійти» на сайті ще раз.',
  denied: `Кабінет доступний лише клієнтам за запрошенням. Напишіть Анастасії: ${CONTACT}`,
}

const SITE_NOTE =
  'Кабінет відкривається тут, у Telegram, або на сайті: увійти можна з будь-якого браузера, на телефоні чи компʼютері.'

// Telegram приймає лише https; локально (без APP_URL) кнопок просто немає
const openButton = () => cabinetButtons('', 'Відкрити кабінет')

export function createBot(): Bot {
  const bot = new Bot(env('TELEGRAM_BOT_TOKEN'))

  bot.command('start', async (ctx) => {
    const from = ctx.from
    if (!from) return
    const sb = db()
    const owners = ownerTgIds()
    const payload = parseStartPayload(ctx.match)

    if (payload.kind === 'login') {
      // Не підтверджуємо одразу: інакше чуже посилання login_… віддало б сесію тому, хто його надіслав
      if (!(await resolveAccount(sb, from, owners))) {
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
      const result = await acceptInvite(sb, from, payload.code, owners)
      if (result.ok) {
        // Анастасії — що людина приєдналась (не критично: збій не заважає клієнту)
        await sendOnceToAll(sb, `joined:${from.id}`, owners, { text: texts.joined(result.fullName), path: '/n/clients' }).catch(
          (e: Error) => console.error('notify joined', e.message),
        )
        await ctx.reply(
          `Вітаю, ${result.fullName}! 🌿\nВаш кабінет готовий: меню, щоденник харчування і зв'язок з Анастасією.\n\n${SITE_NOTE}`,
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

    const account = await resolveAccount(sb, from, owners)
    if (account) {
      const button = openButton()
      await ctx.reply(button ? `Ваш кабінет тут 👇\n\n${SITE_NOTE}` : 'У вас є доступ до кабінету ✅', { reply_markup: button })
    } else {
      await ctx.reply(
        `Це закритий кабінет клієнтів нутриціолога Анастасії.\nЩоб отримати доступ, напишіть ${CONTACT}`,
      )
    }
  })

  bot.callbackQuery(/^login:([\w-]{8,58})$/, async (ctx) => {
    const result = await confirmLogin(db(), ctx.from, ctx.match[1]!, ownerTgIds())
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(LOGIN_TEXT[result])
  })

  bot.catch((err) => console.error('bot error', err.error))
  return bot
}
