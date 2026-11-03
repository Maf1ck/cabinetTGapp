# Кабінет Анастасії (Telegram Mini App)

Закритий застосунок для клієнтів і нутриціолога. Вхід лише через Telegram, без паролів.
Лендинг живе окремо (`nutrinastya`), сюди ведуть кнопки «Увійти» / «Мій кабінет».

## Стек

Vue 3 + TypeScript + pug + scss · Supabase (Postgres, RLS, Storage) · бот на grammY · Vercel.

## Команди

```sh
pnpm install
pnpm dev          # розробка
pnpm build        # типи + збірка
pnpm test:unit    # тести компонентів (vitest)
pnpm test:db      # схема БД і RLS у локальному Postgres (PGlite)
pnpm lint
```

## Налаштування (один раз)

### 1. Telegram-бот
1. У @BotFather: `/newbot` → отримати **токен** і **username** бота.
2. `/setdomain` не потрібен: вхід з браузера йде через бота (deep-link), не через Login Widget.
3. Telegram ID Анастасії: написати @userinfobot → число це `OWNER_TG_ID`.

### 2. Supabase
1. Створити проєкт на supabase.com (регіон ближче до України, напр. Frankfurt).
2. SQL Editor → вставити й виконати `supabase/migrations/0001_schema.sql`.
3. Settings → **General**: Project URL; **API Keys**: anon/publishable і service_role/secret;
   **JWT Keys → Legacy JWT Secret**: секрет для підпису сесій.
4. Роль `nutri` Анастасія отримує автоматично при першому вході (за `OWNER_TG_ID`).

### 3. Змінні середовища
Скопіювати `.env.example` в `.env` (локально) і додати ті самі змінні у Vercel → Settings → Environment Variables.
`VITE_*` у Vercel ставимо типом **Config** (вони публічні), решту секретів **Sensitive**.
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `TELEGRAM_BOT_TOKEN` ніколи не мають
префікса `VITE_`, інакше потраплять у браузер.

### 4. Після першого деплою
```sh
pnpm bot:setup https://<адреса-кабінету>   # вебхук, кнопка «Кабінет» у меню бота
```
Потім у @BotFather → Bot Settings → Configure Mini App вказати ту саму адресу.

## Локальна розробка
`pnpm dev` запускає лише фронтенд, `/api/*` там немає. Повністю, з функціями:
```sh
pnpm dlx vercel dev
```

## API (Vercel-функції)

| Маршрут | Що робить |
|---|---|
| `POST /api/auth/telegram` | `{ initData }` з Mini App → перевірка підпису → `{ token, account }` |
| `POST /api/auth/login` | вхід з браузера: одноразовий токен і посилання на бота |
| `GET /api/auth/login?token=` | опитування: 202 поки чекаємо, 200 + сесія після підтвердження в боті |
| `POST /api/invites` | лише нутриціолог: `{ clientId }` → посилання-запрошення на 7 днів |
| `POST /api/bot` | вебхук Telegram (перевіряє `TELEGRAM_WEBHOOK_SECRET`) |

Вхід з браузера бот підтверджує окремою кнопкою, а не одразу по `/start`: інакше чуже
посилання `login_…` віддало б сесію тому, хто його надіслав.

## Модель доступу

- Користувач = рядок у `public.users` за `telegram_id`.
- Реєстрації немає: клієнта створює Анастасія, клієнт приймає запрошення `t.me/<bot>?start=inv_<код>`.
- Сервер видає JWT із `sub = users.id`; Supabase RLS пропускає клієнта лише до його рядків,
  нутриціолога до всіх.
- `login_tokens`, `invites`, `notifications` без політик: доступні лише серверу (service role).
- Фото й аналізи в приватних бакетах, шлях `<client_id>/<файл>`.

Будь-яка зміна політик має проходити `pnpm test:db`.

## Структура

```
supabase/migrations/   схема, RLS, Storage
supabase/tests/        перевірка RLS
api/                   Vercel-функції: вхід, запрошення, вебхук бота
server/                спільний серверний код: підпис Telegram, JWT, доступ, бот
scripts/bot-setup.mjs  реєстрація вебхука
src/                   Mini App і сайт (один код)
```
