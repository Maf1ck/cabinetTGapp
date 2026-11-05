// Застосовує міграції у PGlite (Postgres у WASM) із заглушками Supabase і перевіряє RLS.
// Запуск: pnpm test:db
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../migrations/', import.meta.url))
const sql = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(dir + f, 'utf8'))
  .join('\n')
const db = new PGlite()

// Заглушки того, що в Supabase є з коробки
await db.exec(`
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, allowed_mime_types text[], file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select string_to_array(name, '/') $$;
`)

await db.exec(sql)
console.log('міграція застосована')

await db.exec(`
  grant usage on schema public, auth, storage to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select, insert, update, delete on all tables in schema storage to authenticated;
`)

// Дані (від імені власника БД, RLS обходиться)
await db.exec(`
  insert into auth.users (id) values
    ('00000000-0000-0000-0000-00000000000a'),
    ('00000000-0000-0000-0000-0000000000b1'),
    ('00000000-0000-0000-0000-0000000000b2');
  insert into users (id, telegram_id, role) values
    ('00000000-0000-0000-0000-00000000000a', 1, 'nutri'),
    ('00000000-0000-0000-0000-0000000000b1', 2, 'client'),
    ('00000000-0000-0000-0000-0000000000b2', 3, 'client');
  insert into clients (id, user_id, full_name) values
    ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'Марія'),
    ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b2', 'Олег');
  insert into menus (id, client_id, week_start, published) values
    ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', '2026-11-02', true),
    ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c1', '2026-11-09', false);
  insert into menu_meals (menu_id, day, meal, title) values
    ('00000000-0000-0000-0000-0000000000e1', 1, 'breakfast', 'Вівсянка'),
    ('00000000-0000-0000-0000-0000000000e2', 1, 'breakfast', 'Чернетка');
  insert into diary_entries (client_id, meal) values
    ('00000000-0000-0000-0000-0000000000c1', 'lunch'),
    ('00000000-0000-0000-0000-0000000000c2', 'lunch');
  insert into payments (client_id, title, amount_uah) values
    ('00000000-0000-0000-0000-0000000000c1', 'Консультація', 400);
  insert into invites (code, client_id, expires_at) values
    ('x', '00000000-0000-0000-0000-0000000000c1', now());
  insert into storage.objects (bucket_id, name) values
    ('diary', '00000000-0000-0000-0000-0000000000c1/a.jpg'),
    ('diary', '00000000-0000-0000-0000-0000000000c2/b.jpg');
`)

const as = async (uid, query) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false)`)
  try {
    const r = await db.query(query)
    return r.rows
  } catch (e) {
    return 'ERR: ' + e.message.split('\n')[0]
  } finally {
    await db.exec(`reset role`)
  }
}

const NUTRI = '00000000-0000-0000-0000-00000000000a'
const MARIA = '00000000-0000-0000-0000-0000000000b1'
const OLEG = '00000000-0000-0000-0000-0000000000b2'
const C1 = '00000000-0000-0000-0000-0000000000c1'
const C2 = '00000000-0000-0000-0000-0000000000c2'

let fails = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(ok ? '  ok  ' : ' FAIL ', name, ok ? '' : `→ ${JSON.stringify(got)} (очікувалось ${JSON.stringify(want)})`)
}
const count = async (uid, q) => (await as(uid, `select count(*)::int n from (${q}) s`))[0]?.n ?? 'ERR'

check('Марія бачить 1 клієнта (себе)', await count(MARIA, 'select * from clients'), 1)
check('Нутриціолог бачить 2 клієнтів', await count(NUTRI, 'select * from clients'), 2)
check('Марія не бачить чужого щоденника', await count(MARIA, `select * from diary_entries where client_id='${C2}'`), 0)
check('Марія бачить свій щоденник', await count(MARIA, 'select * from diary_entries'), 1)
check('Олег не бачить меню Марії', await count(OLEG, 'select * from menus'), 0)
check('Марія бачить лише опубліковане меню', await count(MARIA, 'select * from menus'), 1)
check('Марія не бачить страв чернетки', await count(MARIA, 'select * from menu_meals'), 1)
check('Нутриціолог бачить усі меню', await count(NUTRI, 'select * from menus'), 2)
check('Марія не бачить чужих users', await count(MARIA, 'select * from users'), 1)
check('Марія бачить свою оплату', await count(MARIA, 'select * from payments'), 1)
check('Олег не бачить оплат Марії', await count(OLEG, 'select * from payments'), 0)

// Запис
const w1 = await as(MARIA, `insert into water_logs (client_id, day, glasses) values ('${C1}', '2026-11-03', 3) returning 1`)
check('Марія пише воду собі', Array.isArray(w1), true)
const w2 = await as(MARIA, `insert into water_logs (client_id, day, glasses) values ('${C2}', '2026-11-03', 3) returning 1`)
check('Марія НЕ пише воду Олегові', typeof w2 === 'string' && w2.includes('row-level security'), true)
const p = await as(MARIA, `insert into payments (client_id, title, amount_uah, status) values ('${C1}', 'x', 1, 'paid') returning 1`)
check('Клієнт НЕ створює оплат', typeof p === 'string' && p.includes('row-level security'), true)
const m = await as(MARIA, `insert into menus (client_id, week_start) values ('${C1}', '2026-12-01') returning 1`)
check('Клієнт НЕ створює меню', typeof m === 'string' && m.includes('row-level security'), true)
const d = await as(MARIA, `insert into diary_entries (client_id, meal) values ('${C1}', 'dinner') returning 1`)
check('Марія додає запис у щоденник', Array.isArray(d), true)
const dd = await as(MARIA, `insert into diary_entries (client_id, meal) values ('${C2}', 'dinner') returning 1`)
check('Марія НЕ додає запис Олегові', typeof dd === 'string', true)
await as(MARIA, `update diary_entries set seen_by_nutri = true where client_id='${C1}'`)
check('Клієнт не може поставити «переглянуто»', (await db.query(`select count(*)::int n from diary_entries where seen_by_nutri`)).rows[0].n, 0)
await as(NUTRI, `update diary_entries set seen_by_nutri = true where client_id='${C1}'`)
check('Анастасія ставить «переглянуто»', (await db.query(`select count(*)::int n from diary_entries where seen_by_nutri`)).rows[0].n, 2)

// «Зʼїдено» для клієнта на супроводі — лише зі звітом (фото або власний коментар)
const MEAL = (await db.query(`select id from menu_meals where title = 'Вівсянка'`)).rows[0].id
const eat = () => as(MARIA, `insert into meal_checks (meal_id, client_id) values ('${MEAL}', '${C1}') returning 1`)
const report = (cols, vals) =>
  as(MARIA, `insert into diary_entries (client_id, meal, menu_meal_id, ${cols}) values ('${C1}', 'breakfast', '${MEAL}', ${vals}) returning id`)
const noReport = await eat()
check('На супроводі: без звіту «зʼїдено» не ставиться', typeof noReport === 'string' && noReport.includes('row-level security'), true)
await report('note', `'Вівсянка'`)
check('Назва страви замість коментаря — не звіт', typeof (await eat()) === 'string', true)
await report('photo_path', `'${C2}/b.jpg'`)
check('Фото з чужої папки — не звіт', typeof (await eat()) === 'string', true)
const [noted] = await report('note', `'Зʼїла половину, не встигла сфотографувати'`)
check('З коментарем «зʼїдено» ставиться', Array.isArray(await eat()), true)
check('Марія знімає свою відмітку', Array.isArray(await as(MARIA, `delete from meal_checks where meal_id='${MEAL}' returning 1`)), true)
await db.exec(`delete from diary_entries where id = '${noted.id}'`)
await report('photo_path', `'${C1}/a.jpg'`)
check('З фото «зʼїдено» ставиться', Array.isArray(await eat()), true)
await db.exec(`delete from meal_checks; delete from diary_entries where menu_meal_id is not null`)
await db.exec(`update clients set on_support = false where id = '${C1}'`)
check('Не на супроводі: «зʼїдено» без звіту', Array.isArray(await eat()), true)
await db.exec(`delete from meal_checks; update clients set on_support = true where id = '${C1}'`)
check('Нутриціолог ставить «зʼїдено» без звіту', Array.isArray(await as(NUTRI, `insert into meal_checks (meal_id, client_id) values ('${MEAL}', '${C1}') returning 1`)), true)
check('Марія бачить свою відмітку', await count(MARIA, 'select * from meal_checks'), 1)
check('Олег не бачить відміток Марії', await count(OLEG, 'select * from meal_checks'), 0)
await db.exec(`delete from meal_checks`)

// Вимкнений клієнт: сесія ще жива, але даних уже не бачить
await db.exec(`update clients set active = false where id = '${C1}'`)
check('Вимкнена Марія не бачить свого щоденника', await count(MARIA, 'select * from diary_entries'), 0)
check('Вимкнена Марія не бачить меню', await count(MARIA, 'select * from menus'), 0)
const wOff = await as(MARIA, `insert into water_logs (client_id, day, glasses) values ('${C1}', '2026-11-04', 1) returning 1`)
check('Вимкнена Марія не пише воду', typeof wOff === 'string', true)
check('Нутриціолог і далі бачить її щоденник', await count(NUTRI, `select * from diary_entries where client_id='${C1}'`), 2)
await db.exec(`update clients set active = true where id = '${C1}'`)

// users.id мусить бути акаунтом Auth
const orphan = await db.query(`insert into users (id, telegram_id) values (gen_random_uuid(), 99) returning 1`).catch((e) => e.message)
check('users без акаунта Auth не створюється', typeof orphan === 'string' && orphan.includes('foreign key'), true)

// Службові таблиці
check('Клієнт не бачить invites', await count(MARIA, 'select * from invites'), 0)
check('Навіть Анастасія не читає invites з клієнтської сторони', await count(NUTRI, 'select * from invites'), 0)
check('Клієнт не бачить login_tokens', await count(MARIA, 'select * from login_tokens'), 0)
check('Клієнт не бачить notifications', await count(MARIA, 'select * from notifications'), 0)
check('Клієнт не бачить notification_log', await count(MARIA, 'select * from notification_log'), 0)

// Сховище
check('Марія бачить лише свої файли', await count(MARIA, `select * from storage.objects where bucket_id='diary'`), 1)
check('Нутриціолог бачить усі файли', await count(NUTRI, `select * from storage.objects where bucket_id='diary'`), 2)

console.log(fails ? `\nПровалено перевірок: ${fails}` : '\nУсі перевірки RLS пройдено')
process.exit(fails ? 1 : 0)
