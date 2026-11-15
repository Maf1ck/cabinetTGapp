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
3. Telegram ID нутриціологів: кожен пише @userinfobot → числа через кому це `OWNER_TG_ID` (напр. `111,222`).

### 2. Supabase
1. Створити проєкт на supabase.com (регіон ближче до України, напр. Frankfurt).
2. SQL Editor → виконати по черзі всі файли з `supabase/migrations/` (`0001_…`, `0002_…`).
3. Settings → **General**: Project URL (`https://<ref>.supabase.co`, не адреса панелі);
   **API Keys**: anon/publishable і service_role/secret.
4. Authentication → Sign In / Providers → **вимкнути «Allow new users to sign up»**:
   акаунти створює лише наш сервер.
5. Роль `nutri` нутриціологи отримують автоматично при першому вході (за `OWNER_TG_ID`).

### 3. Змінні середовища
Скопіювати `.env.example` в `.env` (локально) і додати ті самі змінні у Vercel → Settings → Environment Variables.
`VITE_*` у Vercel ставимо типом **Config** (вони публічні), решту секретів **Sensitive**.
`SUPABASE_SERVICE_ROLE_KEY` і `TELEGRAM_BOT_TOKEN` ніколи не мають
префікса `VITE_`, інакше потраплять у браузер.

### 4. Після першого деплою
```sh
pnpm bot:setup https://<адреса-кабінету>   # вебхук, кнопка «Кабінет» у меню бота
```
Потім у @BotFather → Bot Settings → Configure Mini App вказати ту саму адресу.

## Локальна розробка
```sh
pnpm dev       # сайт + /api/* (плагін build/dev-api.ts виконує api/ так само, як Vercel)
pnpm bot:dev   # бот локально, long polling
```
`pnpm bot:dev` знімає вебхук, тож після нього на проді знову виконати `pnpm bot:setup <адреса>`.

## Програма для Windows і Mac (адмінка)
`desktop/` — Electron-оболонка, яка відкриває `/n` з Vercel в окремому вікні. Сайт оновлюється
з деплоєм, тож оболонку перезбирати не треба (лише якщо змінився сам `desktop/main.js`).
```sh
cd desktop
pnpm install
pnpm start     # запустити (перший раз Electron сам завантажиться)
pnpm dist      # інсталятор: desktop/release/Kabinet-Setup-<версія>.exe
```
- Windows-інсталятор пропонує папку `D:\Programs\cabinet-desktop`, якщо є диск D, інакше стандартну в AppData (`desktop/build/installer.nsh`).
- Mac: DMG збирається лише на macOS, тому його збирає GitHub Actions (`.github/workflows/desktop-mac.yml`) при пуші змін у `desktop/` або вручну (Actions → «Desktop app for macOS» → Run workflow). Файл: сторінка запуску → Artifacts → `Kabinet-mac`. Один DMG для M1–M4 та Intel, підпис ad-hoc без Apple-сертифіката, тому під час першого запуску треба «Приватність і безпека» → «Усе одно відкрити».
- Вхід як у браузері: «Увійти через Telegram» → підтвердити в боті. Посилання поза кабінетом
  (бот, Telegram, Instagram) відкриваються в системі, не в програмі.
- Без інтернету показується `offline.html` з кнопкою «Спробувати ще раз».
- Інсталятор не підписаний: Windows SmartScreen попередить «Невідомий видавець» → «Докладніше» → «Усе одно запустити».
- Перевірка без побічних дій: `CABINET_SMOKE_MS=8000 pnpm start` (зовнішні посилання лише в лог);
  `CABINET_URL=<адреса>` — відкрити інший кабінет (напр. локальний).

## API (Vercel-функції)

| Маршрут | Що робить |
|---|---|
| `POST /api/auth/telegram` | `{ initData }` з Mini App → перевірка підпису → `{ session, account }` |
| `GET /api/auth/me` | чи збережена сесія досі має доступ (клієнта могли вимкнути) |
| `POST /api/auth/login` | вхід з браузера: одноразовий токен і посилання на бота |
| `GET /api/auth/login?token=` | опитування: 202 поки чекаємо, 200 + сесія після підтвердження в боті |
| `POST /api/invites` | лише нутриціолог: `{ clientId }` → посилання-запрошення на 7 днів |
| `POST /api/bot` | вебхук Telegram (перевіряє `TELEGRAM_WEBHOOK_SECRET`) |

Вхід з браузера бот підтверджує окремою кнопкою, а не одразу по `/start`: інакше чуже
посилання `login_…` віддало б сесію тому, хто його надіслав.

## Модель доступу

- Користувач = рядок у `public.users` за `telegram_id`.
- Реєстрації немає: клієнта створює Анастасія, клієнт приймає запрошення `t.me/<bot>?start=inv_<код>`.
- Сесії видає Supabase Auth: для кожного користувача є «тихий» акаунт `auth.users`
  (`tg<id>@telegram.invalid`, без пароля, пошта не надсилається), `users.id = auth.users.id`.
  Сервер бере сесію сам (`generateLink` → `verifyOtp`) лише після перевірки Telegram.
- RLS пропускає клієнта лише до його рядків і лише поки картка `active`, нутриціолога до всіх.
- Нутриціологи лише ті, чиї ID зараз в `OWNER_TG_ID` (можна кілька, усі бачать усіх клієнтів): хто випав зі списку, одразу стає клієнтом. Сповіщення для нутриціолога (щоденник, аналізи, дайджест) йдуть кожному.
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
