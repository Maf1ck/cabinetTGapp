-- Журнал надісланих сповіщень у Telegram: ключ події → коли надіслано.
-- Сервер (service role) записує ключ перед надсиланням, тож повтор тієї ж події не дублює повідомлення.
-- Браузеру таблиця не потрібна: RLS увімкнено без жодної політики.
create table notification_log (
  key     text primary key check (char_length(key) <= 200),
  sent_at timestamptz not null default now()
);
alter table notification_log enable row level security;

-- Список покупок збирається з меню тижня. from_menu — рядок згенеровано з рецептів
-- (його кількість оновлюється, коли міняється меню); false — клієнт додав сам.
alter table shopping_items
  add column category  text check (char_length(category) <= 60),
  add column from_menu boolean not null default false;
