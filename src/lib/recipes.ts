// Спільне для рецептів: і для кабінету, і для імпорту з таблиці (server/recipe-sheet.ts)

export const UNITS = ['г', 'мл', 'шт', 'ч.л.', 'ст.л.', 'зубчик', 'л', 'кг'] as const

/** «40 г», «50–60 г», «2 шт»; без кількості — null (тоді говорить примітка: «за смаком»). */
export function formatAmount(from: number | null, to: number | null, unit: string | null): string | null {
  if (from === null) return null
  const qty = to !== null && to !== from ? `${from}–${to}` : `${from}`
  return unit ? `${qty} ${unit}` : qty
}

/** Пошук без урахування регістру й апострофів (ʼ ’ ') — «мʼясо» = «м'ясо». */
export const normalize = (s: string) =>
  s
    .toLocaleLowerCase('uk')
    .replace(/[ʼ’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
