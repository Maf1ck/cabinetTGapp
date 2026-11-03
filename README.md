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
3. Project Settings → API: скопіювати `URL`, `anon key`, `service_role key`, `JWT Secret`.
4. Після першого входу Анастасії виставити їй роль:
   ```sql
   update users set role = 'nutri' where telegram_id = <OWNER_TG_ID>;
   ```
   (з 2-го дня це робитиме сервер автоматично за `OWNER_TG_ID`).

### 3. Змінні середовища
Скопіювати `.env.example` в `.env` (локально) і додати ті самі змінні у Vercel → Settings → Environment Variables.
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `TELEGRAM_BOT_TOKEN` ніколи не мають
префікса `VITE_`, інакше потраплять у браузер.

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
api/                   Vercel-функції: вхід, вебхук бота, крон (з 2-го дня)
src/                   Mini App
```
