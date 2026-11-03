import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { setAccessToken } from '@/lib/supabase'
import { telegramApp } from '@/lib/telegram'

export interface Account {
  userId: string
  role: 'client' | 'nutri'
  firstName: string | null
  clientId: string | null
}

interface Session {
  token: string
  account: Account
}

const STORAGE_KEY = 'cabinet.session'
export const POLL_INTERVAL_MS = 2000
// Токен входу живе 10 хв на сервері
const POLL_TIMEOUT_MS = 10 * 60_000

export type AuthError = 'no_access' | 'expired' | 'network' | null

// exp із JWT, без перевірки підпису: лише щоб не тримати протухлу сесію
function expiresAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    return Number(payload.exp) * 1000
  } catch {
    return 0
  }
}

function loadSession(): Session | null {
  try {
    const s: Session = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return s && expiresAt(s.token) > Date.now() ? s : null
  } catch {
    return null
  }
}

export const useAuth = defineStore('auth', () => {
  const session = ref<Session | null>(null)
  const error = ref<AuthError>(null)
  const waitingBot = ref(false)
  const botUrl = ref<string | null>(null)
  let ready: Promise<void> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | undefined

  const account = computed(() => session.value?.account ?? null)
  const isNutri = computed(() => account.value?.role === 'nutri')

  function apply(s: Session | null) {
    session.value = s
    setAccessToken(s?.token ?? null)
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    else localStorage.removeItem(STORAGE_KEY)
  }

  async function loginWithTelegram(initData: string) {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
    if (res.ok) {
      apply(await res.json())
      error.value = null
    } else {
      apply(null)
      error.value = res.status === 403 ? 'no_access' : 'network'
    }
  }

  /** Один раз при старті: у Telegram входимо за initData, у браузері беремо збережену сесію. */
  function init(): Promise<void> {
    ready ??= (async () => {
      const tg = telegramApp()
      if (tg) {
        tg.ready()
        tg.expand()
        await loginWithTelegram(tg.initData).catch(() => {
          error.value = 'network'
        })
      } else {
        apply(loadSession())
      }
    })()
    return ready
  }

  /** Браузер: відкриваємо бота за одноразовим посиланням і чекаємо підтвердження. */
  async function startBrowserLogin(openWindow: (url: string) => void = (u) => window.open(u, '_blank')) {
    stopPolling()
    error.value = null
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' })
      if (!res.ok) throw new Error()
      const { token, botUrl: url } = await res.json()
      botUrl.value = url
      waitingBot.value = true
      openWindow(url)
      poll(token, Date.now() + POLL_TIMEOUT_MS)
    } catch {
      error.value = 'network'
    }
  }

  function poll(token: string, deadline: number) {
    pollTimer = setTimeout(async () => {
      if (Date.now() > deadline) return finish('expired')
      try {
        const res = await fetch(`/api/auth/login?token=${encodeURIComponent(token)}`)
        if (res.status === 202) return poll(token, deadline)
        if (res.ok) {
          apply(await res.json())
          return finish(null)
        }
        finish(res.status === 403 ? 'no_access' : 'expired')
      } catch {
        poll(token, deadline) // мережа моргнула: пробуємо далі, поки не вийде час
      }
    }, POLL_INTERVAL_MS)
  }

  function finish(err: AuthError) {
    waitingBot.value = false
    error.value = err
  }

  function stopPolling() {
    clearTimeout(pollTimer)
    waitingBot.value = false
  }

  function logout() {
    stopPolling()
    apply(null)
  }

  return {
    session,
    account,
    isNutri,
    error,
    waitingBot,
    botUrl,
    init,
    startBrowserLogin,
    stopPolling,
    logout,
  }
})
