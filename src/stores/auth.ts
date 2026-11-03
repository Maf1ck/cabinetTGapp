import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { telegramApp } from '@/lib/telegram'

export interface Account {
  userId: string
  telegramId: number
  role: 'client' | 'nutri'
  firstName: string | null
  clientId: string | null
}

interface LoginResponse {
  session: { access_token: string; refresh_token: string }
  account: Account
}

export const POLL_INTERVAL_MS = 2000
// Токен входу живе 10 хв на сервері
const POLL_TIMEOUT_MS = 10 * 60_000

export type AuthError = 'no_access' | 'expired' | 'network' | null

export const useAuth = defineStore('auth', () => {
  const account = ref<Account | null>(null)
  const error = ref<AuthError>(null)
  const waitingBot = ref(false)
  const botUrl = ref<string | null>(null)
  let ready: Promise<void> | null = null
  let pollTimer: ReturnType<typeof setTimeout> | undefined

  const isNutri = computed(() => account.value?.role === 'nutri')

  async function signIn({ session, account: acc }: LoginResponse) {
    const { error: e } = await supabase().auth.setSession(session)
    if (e) throw e
    account.value = acc
    error.value = null
  }

  async function signOutLocal() {
    account.value = null
    await supabase().auth.signOut({ scope: 'local' }).catch(() => {})
  }

  async function loginWithTelegram(initData: string) {
    const res = await fetch('/api/auth/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
    if (res.ok) return signIn(await res.json())
    await signOutLocal()
    error.value = res.status === 403 ? 'no_access' : 'network'
  }

  // Браузер: сесію зберігає supabase-js; сервер підтверджує, що доступ досі є (клієнта могли вимкнути)
  async function restore() {
    const { data } = await supabase().auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    const res = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` } })
    if (res.ok) account.value = (await res.json()).account
    else if (res.status === 403) await signOutLocal()
    else error.value = 'network'
  }

  /** Один раз при старті: у Telegram входимо за initData, у браузері піднімаємо збережену сесію. */
  function init(): Promise<void> {
    ready ??= (async () => {
      const tg = telegramApp()
      try {
        if (tg) {
          tg.ready()
          tg.expand()
          await loginWithTelegram(tg.initData)
        } else {
          await restore()
        }
      } catch {
        error.value = 'network'
      }
      // Supabase не зміг оновити сесію (відкликано, прострочено) → на екран входу
      supabase().auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') account.value = null
      })
    })()
    return ready
  }

  /**
   * Браузер: відкриваємо бота за одноразовим посиланням і чекаємо підтвердження.
   * Вкладку відкриваємо одразу по кліку, ще до запиту: інакше Safari заблокує її як спливне вікно.
   */
  async function startBrowserLogin(
    openWindow: () => { location: { href: string }; close(): void } | null = () => window.open('', '_blank'),
  ) {
    stopPolling()
    error.value = null
    const win = openWindow()
    try {
      const res = await fetch('/api/auth/login', { method: 'POST' })
      if (!res.ok) throw new Error()
      const { token, botUrl: url } = await res.json()
      botUrl.value = url
      waitingBot.value = true
      if (win) win.location.href = url
      poll(token, Date.now() + POLL_TIMEOUT_MS)
    } catch {
      error.value = 'network'
      win?.close()
    }
  }

  function poll(token: string, deadline: number) {
    pollTimer = setTimeout(async () => {
      if (Date.now() > deadline) return finish('expired')
      try {
        const res = await fetch(`/api/auth/login?token=${encodeURIComponent(token)}`)
        if (res.status === 202) return poll(token, deadline)
        if (res.ok) {
          await signIn(await res.json())
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

  async function logout() {
    stopPolling()
    account.value = null
    await supabase().auth.signOut().catch(() => {})
  }

  return {
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
