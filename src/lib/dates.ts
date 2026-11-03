// Дати в часовому поясі пристрою. Дні в базі зберігаються як 'YYYY-MM-DD', тиждень з понеділка.
const pad = (n: number) => String(n).padStart(2, '0')

export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export const fromIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export const addDays = (d: Date, days: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

/** 1 = понеділок … 7 = неділя (як menu_meals.day) */
export const weekday = (d: Date) => ((d.getDay() + 6) % 7) + 1

export const weekStart = (d: Date) => {
  const x = addDays(d, 1 - weekday(d))
  x.setHours(0, 0, 0, 0)
  return x
}

const long = new Intl.DateTimeFormat('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' })
const dayMonth = new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long' })
const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' })

/** «Четвер, 29 жовтня» */
export const longDate = (d: Date) => {
  const s = long.format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** «29 жовтня» */
export const shortDate = (d: Date) => dayMonth.format(d)

export const timeOf = (d: Date) => time.format(d)

export const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'] as const

/** «Пн, 2 листопада · 19:00» */
export const appointmentLabel = (d: Date) =>
  `${DAY_SHORT[weekday(d) - 1]}, ${shortDate(d)} · ${timeOf(d)}`

export function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 5) return 'Доброї ночі'
  if (h < 12) return 'Доброго ранку'
  if (h < 18) return 'Доброго дня'
  return 'Доброго вечора'
}

/** Скільки днів поспіль є записи, рахуючи від сьогодні (або від учора, якщо сьогодні ще порожньо). */
export function streak(days: Iterable<string>, today: Date): number {
  const set = new Set(days)
  let d = set.has(isoDate(today)) ? today : addDays(today, -1)
  let n = 0
  while (set.has(isoDate(d))) {
    n++
    d = addDays(d, -1)
  }
  return n
}

/** «1 день», «3 дні», «12 днів» */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const days = (n: number) => `${n} ${plural(n, 'день', 'дні', 'днів')}`
