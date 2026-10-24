import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { SiteId } from '@/site/site-id'

const mocks = vi.hoisted(() => ({
  read: vi.fn<(query: unknown) => Promise<unknown>>(),
  write: vi.fn<(query: unknown) => Promise<unknown>>()
}))

vi.mock('@/common/db', () => ({ read: mocks.read, write: mocks.write }))

vi.mock('@/dao/browse-history', () => ({
  fetchDailyHistoryRange: vi.fn(async () => [])
}))

const { fetchDailyByPathDate, fetchRecentDaily, clearDailies } = await import('@/dao/onejav-daily-dao')
const { fetchDailyHistoryRange } = await import('@/dao/browse-history')
const { useDailyHistoryStore } = await import('@/store/daily-history-store')

const rangeMock = vi.mocked(fetchDailyHistoryRange)

/** 一条 onejav_daily 行（单日汇总，和每日统计数字是两套数据） */
function dailyRow(pathDate: string) {
  return {
    id: 1,
    user_id: 'test-user',
    sister_number: 3,
    load_completed: true,
    path_date: pathDate,
    release_date: pathDate.replace(/^\//, '').replace(/\//g, '-'),
    original_release_date: 'Oct. 5, 2026',
    watch_time: new Date('2026-10-05T12:00:00.000Z'),
    site: SiteId.ONEJAV
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  rangeMock.mockReset()
  rangeMock.mockResolvedValue([])
  mocks.read.mockReset()
  mocks.read.mockResolvedValue([])
  // 模块级缓存（dailiesRef / loadedMonth）跨用例存活，每个用例从干净状态开始
  clearDailies()
})

describe('按月加载每日统计', () => {
  it('每日统计那一半失败时不算加载完，同月后续日期会整月重试', async () => {
    rangeMock.mockRejectedValueOnce(new Error('db down'))

    await expect(fetchDailyByPathDate('/2026/10/05', SiteId.ONEJAV)).rejects.toThrow('db down')
    expect(rangeMock).toHaveBeenCalledTimes(1)

    await fetchDailyByPathDate('/2026/10/20', SiteId.ONEJAV)

    expect(rangeMock).toHaveBeenCalledTimes(2)
    expect(rangeMock.mock.calls[1]?.[0].format('YYYY-MM-DD')).toBe('2026-10-01')
  })

  it('整月成功后，同月其他日期不再重复拉取', async () => {
    await fetchDailyByPathDate('/2026/10/05', SiteId.ONEJAV)
    await fetchDailyByPathDate('/2026/10/20', SiteId.ONEJAV)

    expect(rangeMock).toHaveBeenCalledTimes(1)
  })

  it('拉到的行灌进每日统计缓存', async () => {
    rangeMock.mockResolvedValue([
      { path_date: '/2026/10/05', history_number: 4, release_date: '2026-10-05', site: SiteId.ONEJAV }
    ])

    await fetchDailyByPathDate('/2026/10/05', SiteId.ONEJAV)

    expect(useDailyHistoryStore().countOf('/2026/10/05')).toBe(4)
  })

  it('clearDailies 之后同月会重新拉取（退出登录换账号）', async () => {
    await fetchDailyByPathDate('/2026/10/05', SiteId.ONEJAV)

    clearDailies()
    await fetchDailyByPathDate('/2026/10/20', SiteId.ONEJAV)

    expect(rangeMock).toHaveBeenCalledTimes(2)
  })

  it('单日行已缓存，仍会补拉本月计数（两套数据不能互相短路）', async () => {
    // 先把一条单日行放进 dailiesRef：模拟「刚在这个日期上呆过」
    mocks.read.mockResolvedValueOnce([dailyRow('/2026/10/05')])
    await fetchRecentDaily(10)

    await fetchDailyByPathDate('/2026/10/05', SiteId.ONEJAV)

    expect(rangeMock).toHaveBeenCalledTimes(1)
  })
})
