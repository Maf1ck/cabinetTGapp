import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseOwnerIds } from '../env'

const sendMessage = vi.fn<(chatId: number, text: string) => Promise<void>>()

vi.mock('grammy', async (orig) => ({
  ...(await orig<typeof import('grammy')>()),
  Api: class {
    sendMessage = sendMessage
  },
}))

// мінімальний sb: журнал сповіщень як Set ключів
function fakeLog() {
  const keys = new Set<string>()
  const sb = {
    from: () => ({
      insert: async ({ key }: { key: string }) => {
        if (keys.has(key)) return { error: { code: '23505' } }
        keys.add(key)
        return { error: null }
      },
      delete: () => ({
        eq: async (_col: string, key: string) => {
          keys.delete(key)
          return { error: null }
        },
      }),
    }),
  }
  return { sb: sb as unknown as SupabaseClient, keys }
}

describe('OWNER_TG_ID', () => {
  it('приймає один ID або список', () => {
    expect(parseOwnerIds('111')).toEqual([111])
    expect(parseOwnerIds('111, 222')).toEqual([111, 222])
    expect(parseOwnerIds('111;222 111')).toEqual([111, 222])
  })

  it('відхиляє порожнє, нулі й нечислове', () => {
    for (const bad of ['', '0', 'abc', '111,x', '-5', '1.5']) expect(() => parseOwnerIds(bad)).toThrow('OWNER_TG_ID')
  })
})

describe('сповіщення нутриціологам', () => {
  beforeEach(() => {
    sendMessage.mockReset()
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '123:abc')
  })

  it('надсилає кожному, повторно не шле', async () => {
    const { sendOnceToAll } = await import('../notify')
    const { sb } = fakeLog()

    expect(await sendOnceToAll(sb, 'digest:d', [1, 2], { text: 'x' })).toBe('sent')
    expect(sendMessage.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2])

    expect(await sendOnceToAll(sb, 'digest:d', [1, 2], { text: 'x' })).toBe('duplicate')
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('збій в одного не блокує іншого і дає повторити лише його', async () => {
    const { sendOnceToAll } = await import('../notify')
    const { sb, keys } = fakeLog()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMessage.mockImplementation(async (id) => {
      if (id === 1) throw new Error('403')
    })

    expect(await sendOnceToAll(sb, 'lab:1', [1, 2], { text: 'x' })).toBe('sent')
    expect([...keys]).toEqual(['lab:1:2'])
  })
})
