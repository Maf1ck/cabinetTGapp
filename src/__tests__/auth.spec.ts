import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { POLL_INTERVAL_MS, useAuth } from '../stores/auth'

// Supabase Auth підміняємо: перевіряємо, що стор кладе в нього сесію і забирає її
const authApi = vi.hoisted(() => ({
  setSession: vi.fn<(s: unknown) => Promise<{ error: null }>>(),
  getSession: vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>(),
  signOut: vi.fn<(o?: unknown) => Promise<{ error: null }>>(),
  onAuthStateChange: vi.fn<(cb: (event: string) => void) => void>(),
}))
vi.mock('../lib/supabase', () => ({ supabase: () => ({ auth: authApi }) }))

const account = { userId: 'u1', telegramId: 42, role: 'client', firstName: 'Марія', clientId: 'c1' }
const session = { access_token: 'access', refresh_token: 'refresh' }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
const reply = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))
const noop = () => vi.fn<() => void>()
const fakeWindow = () => ({ location: { href: '' }, close: noop() })

describe('useAuth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    delete window.Telegram
    vi.useFakeTimers()
    authApi.setSession.mockResolvedValue({ error: null })
    authApi.signOut.mockResolvedValue({ error: null })
    authApi.getSession.mockResolvedValue({ data: { session: null } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('у браузері відкриває бота і входить після підтвердження', async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockReturnValueOnce(reply(200, { token: 'login123', botUrl: 'https://t.me/bot?start=login_login123' }))
      .mockReturnValueOnce(reply(202, { status: 'pending' }))
      .mockReturnValueOnce(reply(200, { session, account }))
    vi.stubGlobal('fetch', fetchMock)
    const win = fakeWindow()

    const auth = useAuth()
    await auth.startBrowserLogin(() => win)
    expect(win.location.href).toBe('https://t.me/bot?start=login_login123')
    expect(auth.waitingBot).toBe(true)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // pending
    expect(auth.account).toBeNull()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // підтверджено

    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/login?token=login123')
    expect(authApi.setSession).toHaveBeenCalledWith(session)
    expect(auth.account).toEqual(account)
    expect(auth.waitingBot).toBe(false)
  })

  it('без запрошення показує no_access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<Fetch>().mockReturnValueOnce(reply(200, { token: 't', botUrl: 'u' })).mockReturnValueOnce(reply(403)),
    )
    const auth = useAuth()
    await auth.startBrowserLogin(() => fakeWindow())
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(auth.error).toBe('no_access')
    expect(auth.account).toBeNull()
  })

  it('закриває заготовлену вкладку, якщо сервер недоступний', async () => {
    vi.stubGlobal('fetch', vi.fn<Fetch>().mockReturnValueOnce(reply(500)))
    const win = fakeWindow()
    const auth = useAuth()
    await auth.startBrowserLogin(() => win)
    expect(auth.error).toBe('network')
    expect(win.close).toHaveBeenCalled()
  })

  it('у Telegram входить за initData', async () => {
    const fetchMock = vi.fn<Fetch>().mockReturnValue(reply(200, { session, account }))
    vi.stubGlobal('fetch', fetchMock)
    window.Telegram = {
      WebApp: { initData: 'query=1&hash=x', colorScheme: 'light', ready: noop(), expand: noop(), openTelegramLink: noop() },
    }

    const auth = useAuth()
    await auth.init()
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ initData: 'query=1&hash=x' })
    expect(authApi.setSession).toHaveBeenCalledWith(session)
    expect(auth.account).toEqual(account)
  })

  it('у браузері піднімає збережену сесію, якщо доступ досі є', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: { access_token: 'access' } } })
    const fetchMock = vi.fn<Fetch>().mockReturnValue(reply(200, { account }))
    vi.stubGlobal('fetch', fetchMock)

    const auth = useAuth()
    await auth.init()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', { headers: { authorization: 'Bearer access' } })
    expect(auth.account).toEqual(account)
  })

  it('викидає сесію, якщо доступ відкликали', async () => {
    authApi.getSession.mockResolvedValue({ data: { session: { access_token: 'access' } } })
    vi.stubGlobal('fetch', vi.fn<Fetch>().mockReturnValue(reply(403)))

    const auth = useAuth()
    await auth.init()
    expect(auth.account).toBeNull()
    expect(authApi.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
