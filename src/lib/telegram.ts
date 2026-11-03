// Мінімум із Telegram.WebApp, який нам потрібен (скрипт підключено в index.html)
interface TelegramWebApp {
  initData: string
  colorScheme: 'light' | 'dark'
  ready(): void
  expand(): void
  openTelegramLink(url: string): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

/** Mini App відкрита в Telegram (поза ним initData порожній). */
export function telegramApp(): TelegramWebApp | null {
  const app = window.Telegram?.WebApp
  return app?.initData ? app : null
}
