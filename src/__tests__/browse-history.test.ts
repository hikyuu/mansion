import { beforeEach, describe, expect, it, vi } from 'vitest'

/** 记录 gte('watch_time', …) 实际收到的游标 */
const captured = vi.hoisted(() => ({ cursors: [] as string[] }))

vi.mock('@/common/db', () => {
  const chain = {
    from: () => chain,
    select: () => chain,
    in: () => chain,
    eq: () => chain,
    upsert: () => chain,
    gte: (_column: string, value: string) => {
      captured.cursors.push(value)
      return chain
    }
  }
  return {
    read: async (query: (db: unknown) => unknown) => query(chain),
    write: async () => []
  }
})

const { fetchHistoriesSince } = await import('@/dao/browse-history')

describe('fetchHistoriesSince', () => {
  beforeEach(() => {
    captured.cursors.length = 0
  })

  it('游标由调用方持有：同一 since 两次调用得到同一查询', async () => {
    const since = new Date('2026-10-01T00:00:00.000Z')

    await fetchHistoriesSince(since)
    await fetchHistoriesSince(since)

    expect(captured.cursors).toEqual([since.toISOString(), since.toISOString()])
  })

  it('不同 since 得到不同查询，模块自己不会把游标往前挪', async () => {
    const first = new Date('2026-10-01T00:00:00.000Z')
    const second = new Date('2026-10-02T00:00:00.000Z')

    await fetchHistoriesSince(first)
    await fetchHistoriesSince(second)

    expect(captured.cursors).toEqual([first.toISOString(), second.toISOString()])
  })
})
