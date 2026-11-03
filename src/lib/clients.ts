import type { ClientRow } from '@/api/nutri'

/** «Марія Кравець» → «МК» */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** «Марія Кравець» → «Марія К.» */
export const shortName = (name: string) => {
  const [first, last] = name.split(/\s+/)
  return last ? `${first} ${last[0]}.` : (first ?? name)
}

/** «Супровід · тиж 3/4» */
export function programLabel(c: Pick<ClientRow, 'program_title' | 'program_week' | 'program_weeks'>): string {
  const title = c.program_title ?? ''
  if (c.program_week && c.program_weeks) return `${title || 'Супровід'} · тиж ${c.program_week}/${c.program_weeks}`
  return title
}
