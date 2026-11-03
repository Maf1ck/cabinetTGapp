// Серверні змінні середовища. Без них функція падає одразу з зрозумілою помилкою,
// а не десь посередині запиту.
export function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Не задано змінну середовища ${name}`)
  return value
}

export const ownerTgId = () => Number(env('OWNER_TG_ID'))

export const botUsername = () => env('VITE_BOT_USERNAME').replace(/^@/, '')

// Адреса кабінету для кнопки Mini App у боті
export function appUrl(): string {
  const explicit = process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (prod) return `https://${prod}`
  throw new Error('Не задано APP_URL')
}
