-- Посилення після перевірки безпеки.

-- 1. Сховище приймає лише ті файли, які кабінет справді завантажує.
--    Без цього клієнт міг покласти в «аналізи» HTML чи SVG зі скриптом — і він виконався б,
--    коли Анастасія відкриє файл за підписаним посиланням.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 10 * 1024 * 1024
 where id = 'diary';

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
       file_size_limit = 15 * 1024 * 1024
 where id = 'labs';

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 10 * 1024 * 1024
 where id = 'recipes';

-- 2. Посилання, які бачить клієнт, — лише https (без javascript: та інших схем).
--    not valid: старі рядки не перевіряються, нові й змінені — так.
alter table appointments
  add constraint appointments_zoom_url_https check (zoom_url is null or zoom_url ~ '^https://') not valid;
alter table payments
  add constraint payments_pay_url_https check (pay_url is null or pay_url ~ '^https://') not valid;

-- 3. Розумні межі довжини для тексту, який пише клієнт (щоб не засипати базу мегабайтами).
alter table diary_entries
  add constraint diary_entries_note_len check (note is null or char_length(note) <= 2000) not valid;
alter table shopping_items
  add constraint shopping_items_name_len check (char_length(name) <= 120) not valid,
  add constraint shopping_items_amount_len check (amount is null or char_length(amount) <= 60) not valid;
alter table lab_files
  add constraint lab_files_title_len check (char_length(title) <= 120) not valid;
