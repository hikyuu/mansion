// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import jquery from 'jquery'
import { SiteAbstract } from '@/site/site-abstract'
import { SiteId } from '@/site/site-id'
import Waterfall from '@/waterfall/waterfall'
import type { Selector } from '@/waterfall/waterfall'
import { useSisterStore } from '@/store/sister-store'
import { useSiteStore } from '@/store/site-store'
import { useConfigStore } from '@/store/config-store'
import { getHistories, uploadHistory, type HistoryDto } from '@/dao/browse-history'
import {
  getDetailFromJavStore,
  getJavstoreUrl,
  getThumbnailUrlFromDetail,
  getTitleFromDetail
} from '@/site/javstore/javstore-api'
import { ProjectError } from '@/common/errors'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_addStyle: vi.fn<(css: string) => void>(),
  monkeyWindow: {}
}))

vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))

vi.mock('@/dao/browse-history', () => ({
  getHistories: vi.fn<(serialNumbers: string[]) => Promise<unknown[]>>(),
  uploadHistory: vi.fn<(serialNumber: string, info: unknown) => Promise<unknown[]>>()
}))

vi.mock('@/site/javstore/javstore-api', () => ({
  getJavstoreUrl: vi.fn<(serialNumber: string, retry?: number) => Promise<string | null>>(),
  getDetailFromJavStore: vi.fn<(url: string, retry?: number) => Promise<unknown>>(),
  getTitleFromDetail: vi.fn<(detail: unknown) => string | undefined>(),
  getThumbnailUrlFromDetail: vi.fn<(detail: unknown, serialNumber: string) => Promise<string[]>>()
}))

const getHistoriesMock = vi.mocked(getHistories)
const uploadHistoryMock = vi.mocked(uploadHistory)
const getDetailFromJavStoreMock = vi.mocked(getDetailFromJavStore)
const getJavstoreUrlMock = vi.mocked(getJavstoreUrl)
const getTitleMock = vi.mocked(getTitleFromDetail)
const getThumbnailUrlMock = vi.mocked(getThumbnailUrlFromDetail)

class FakeSite extends SiteAbstract {
  name = 'fake'
  siteId = SiteId.JAVDB
  selector: Selector = {
    next: 'a.next',
    item: 'div.item',
    container: 'div.list',
    pagination: 'nav.pagination',
    serialNumber: 'div.serial',
    date: 'div.date',
    pathDateFrom: 'dateText',
    link: 'div.title'
  }
  waterfall: Waterfall
  theme = { PRIMARY_COLOR: '#000', SECONDARY_COLOR: '#fff', WARNING_COLOR: '#ff0' }

  constructor() {
    super()
    this.waterfall = new Waterfall(this, this.selector)
  }

  mount(): void {}
  async resolveElements(): Promise<JQuery[]> {
    return []
  }
  download(): void {}
  showControlPanel(): boolean {
    return true
  }
  allLoadCompleted(): void {}
}

const SERIAL = 'ABC123'

/** 一条浏览历史行，只关心判重会用到的字段，其余按最小合法值补齐 */
function historyRow(serial_number: string, path_date: string, site: SiteId): HistoryDto {
  return {
    id: 1,
    user_id: 'test-user',
    serial_number,
    path_date,
    release_date: path_date.replace(/^\//, '').replace(/\//g, '-'),
    original_release_date: '2026-10-01',
    watch_time: new Date(),
    site
  }
}

function renderItem(serial = SERIAL): JQuery {
  document.body.innerHTML = `
    <div class="list">
      <div class="item">
        <div class="serial">${serial}</div>
        <div class="date">2026-10-01</div>
        <div class="title"></div>
      </div>
    </div>`
  return jquery('div.item').first()
}

function setupSite(options: { skipRead?: boolean } = {}): FakeSite {
  setActivePinia(createPinia())
  const site = new FakeSite()
  useSiteStore().setSite(site)
  useConfigStore().sites.set('fake', {
    loadThumbnailSwitch: true,
    scrollStatus: 1,
    smooth: 1,
    downloadMethod: 'miao',
    navigationPoint: 0,
    skipRead: options.skipRead ?? false,
    lazyLimit: 100,
    onlyShowDownloadable: false
  })
  return site
}

beforeEach(() => {
  vi.clearAllMocks()
  getHistoriesMock.mockResolvedValue([])
  uploadHistoryMock.mockResolvedValue([])
  getJavstoreUrlMock.mockResolvedValue('https://javstore.net/detail/1')
  getDetailFromJavStoreMock.mockResolvedValue(document.implementation.createHTMLDocument('detail'))
  getTitleMock.mockReturnValue('素人 初体験')
  getThumbnailUrlMock.mockResolvedValue(['https://img.example.com/1.jpg'])
})

describe('processThumbnail 成功路径', () => {
  it('挂上 id、缩略图与状态 202', async () => {
    const site = setupSite()
    const item = renderItem()

    await site.processThumbnail(SERIAL, item)

    expect(item.attr('id')).toBe(SERIAL)
    const img = item.find('#thumbnail img').first()
    expect(img.attr('src')).toBe('https://img.example.com/1.jpg')
    expect(useSisterStore().getInfo(SERIAL)?.status).toBe(202)
  })

  it('标题命中关键词时写入 likeWords', async () => {
    const site = setupSite()
    useConfigStore().common.keyword.like = ['初体験']
    useConfigStore().common.keyword.unlike = ['NTR']
    const item = renderItem()

    await site.processThumbnail(SERIAL, item)

    expect(useSisterStore().getInfo(SERIAL)?.likeWords).toEqual(['初体験'])
    expect(useSisterStore().getInfo(SERIAL)?.unlikeWords).toEqual([])
  })

  it('写入 javstore 详情地址', async () => {
    const site = setupSite()
    const item = renderItem()

    await site.processThumbnail(SERIAL, item)

    expect(useSisterStore().getInfo(SERIAL)?.javStoreUrl).toBe('https://javstore.net/detail/1')
  })
})

describe('processThumbnail 失败路径', () => {
  it('搜不到 javstore 结果 → 最终状态 500 并留下重试链接', async () => {
    const site = setupSite()
    getJavstoreUrlMock.mockResolvedValue(null)
    const item = renderItem()

    await expect(site.processThumbnail(SERIAL, item)).rejects.toBeInstanceOf(ProjectError)

    expect(useSisterStore().getInfo(SERIAL)?.status).toBe(500)
    expect(item.find('a[id^="javstore_"]').text()).toContain('没找到')
  })

  it('跳过已读时抛出 ProjectError 且不改状态', async () => {
    const site = setupSite({ skipRead: true })
    getHistoriesMock.mockResolvedValue([historyRow(SERIAL, '/2026/10/01', SiteId.JAVDB)])
    const item = renderItem()

    await expect(site.processThumbnail(SERIAL, item)).rejects.toThrow('跳过已读')
    expect(getThumbnailUrlMock).not.toHaveBeenCalled()
  })
})

describe('updateRepeat 判重', () => {
  it('其他站点看过同一番号 → repeatSite 指向该站点', async () => {
    const site = setupSite()
    getHistoriesMock.mockResolvedValue([historyRow(SERIAL, '/2020/01/01', SiteId.ONEJAV)])
    const item = renderItem()

    await site.processThumbnail(SERIAL, item)

    const info = useSisterStore().getInfo(SERIAL)
    expect(info?.haveRead).toBe(true)
    expect(info?.repeatSite).toBe(SiteId.ONEJAV)
  })
})
