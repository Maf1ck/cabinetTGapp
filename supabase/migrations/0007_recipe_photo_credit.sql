-- Фото страв зі сторонніх джерел (Wikimedia Commons тощо) за ліцензією вимагають підпису:
-- автор, ліцензія і посилання на оригінал. Власні фото Анастасії — без підпису (null).
alter table recipes
  add column if not exists photo_credit text,
  add column if not exists photo_source text;

alter table recipes
  add constraint recipes_photo_source_https check (photo_source is null or photo_source ~ '^https://') not valid,
  add constraint recipes_photo_credit_len check (photo_credit is null or char_length(photo_credit) <= 200) not valid;
