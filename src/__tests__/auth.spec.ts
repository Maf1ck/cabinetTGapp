import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { POLL_INTERVAL_MS, useAuth } from '../stores/auth'

const account = { userId: 'u1', role: 'client', firstName: 'Марія', clientId: 'c1' }
// JWT з exp далеко в майбутньому (підпис фронтенд не перевіряє)
const token = `h.${btoa(JSON.stringify({ exp: 4_000_000_000 }))}.s`

const reply = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

type Fetch = (url: string, init?: RequestInit) => Promise<Response>
const noop = () => vi.fn<() => void>()

describe('useAuth', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    delete window.Telegram
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('у браузері відкриває бота і входить після підтвердження', async () => {
    const fetchMock = vi
      .fn<Fetch>()
      .mockReturnValueOnce(reply(200, { token: 'login123', botUrl: 'https://t.me/bot?start=login_login123' }))
      .mockReturnValueOnce(reply(202, { status: 'pending' }))
      .mockReturnValueOnce(reply(200, { token, account }))
    vi.stubGlobal('fetch', fetchMock)
    const open = vi.fn<(url: string) => void>()

    const auth = useAuth()
    await auth.startBrowserLogin(open)
    expect(open).toHaveBeenCalledWith('https://t.me/bot?start=login_login123')
    expect(auth.waitingBot).toBe(true)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // pending
    expect(auth.account).toBeNull()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS) // підтверджено

    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/login?token=login123')
    expect(auth.account).toEqual(account)
    expect(auth.waitingBot).toBe(false)
    expect(JSON.parse(localStorage.getItem('cabinet.session')!).token).toBe(token)
  })

  it('без запрошення показує no_access', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<Fetch>().mockReturnValueOnce(reply(200, { token: 't', botUrl: 'u' })).mockReturnValueOnce(reply(403)),
    )
    const auth = useAuth()
    await auth.startBrowserLogin(() => {})
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    expect(auth.error).toBe('no_access')
    expect(auth.account).toBeNull()
  })

  it('у Telegram входить за initData', async () => {
    const fetchMock = vi.fn<Fetch>().mockReturnValue(reply(200, { token, account }))
    vi.stubGlobal('fetch', fetchMock)
    window.Telegram = {
      WebApp: { initData: 'query=1&hash=x', colorScheme: 'light', ready: noop(), expand: noop(), openTelegramLink: noop() },
    }

    const auth = useAuth()
    await auth.init()
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ initData: 'query=1&hash=x' })
    expect(auth.account).toEqual(account)
  })

  it('піднімає збережену сесію і викидає протухлу', async () => {
    localStorage.setItem('cabinet.session', JSON.stringify({ token, account }))
    const auth = useAuth()
    await auth.init()
    expect(auth.account).toEqual(account)

    setActivePinia(createPinia())
    const expired = `h.${btoa(JSON.stringify({ exp: 1 }))}.s`
    localStorage.setItem('cabinet.session', JSON.stringify({ token: expired, account }))
    const fresh = useAuth()
    await fresh.init()
    expect(fresh.account).toBeNull()
  })
})
