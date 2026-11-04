-- Щоденник: відчуття навколо прийому їжі (без калорій — як у дизайні)
alter table diary_entries
  add column hunger   smallint check (hunger   between 1 and 5),  -- наскільки голодні до
  add column fullness smallint check (fullness between 1 and 5),  -- ситість після
  add column mood     text     check (char_length(mood) <= 40);

-- Календар: тривалість зустрічі, щоб малювати її на сітці і бачити накладки
alter table appointments
  add column duration_min smallint not null default 45 check (duration_min between 15 and 240);
