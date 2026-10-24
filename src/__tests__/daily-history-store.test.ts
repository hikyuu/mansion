import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDailyHistoryStore } from '@/store/daily-history-store'
import type { DailyHistoryDto } from '@/dao/browse-history'
import { SiteId } from '@/site/site-id'

function row(pathDate: string, count: number): DailyHistoryDto {
  return {
    path_date: pathDate,
    history_number: count,
    release_date: pathDate.replace(/^\//, '').replace(/\//g, '-'),
    site: SiteId.ONEJAV
  }
}

describe('每日统计缓存', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('晚到的旧响应不会把数字改小', () => {
    const store = useDailyHistoryStore()

    store.fill([row('/2026/10/01', 7)])
    store.fill([row('/2026/10/01', 3)])

    expect(store.countOf('/2026/10/01')).toBe(7)
  })

  it('没有记录的日期取 0，而不是 undefined', () => {
    const store = useDailyHistoryStore()

    expect(store.countOf('/2026/10/02')).toBe(0)
  })

  it('clear 清空所有缓存（退出登录时用）', () => {
    const store = useDailyHistoryStore()
    store.fill([row('/2026/10/01', 7)])

    store.clear()

    expect(store.countOf('/2026/10/01')).toBe(0)
  })
})
