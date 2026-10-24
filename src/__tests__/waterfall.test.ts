// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import jquery from 'jquery'
import { Pagination } from '@/waterfall/pagination'
import Waterfall from '@/waterfall/waterfall'
import type { Selector, WaterfallHost } from '@/waterfall/waterfall'
import { useConfigStore } from '@/store/config-store'
import { useSiteStore } from '@/store/site-store'
import { useSisterStore } from '@/store/sister-store'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_addStyle: vi.fn<(css: string) => void>(),
  monkeyWindow: {}
}))

vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))

const selector: Selector = {
  next: 'a.next',
  item: 'div.item',
  container: 'div.list',
  pagination: 'nav.pagination',
  serialNumber: 'div.serial',
  date: 'div.date',
  pathDateFrom: 'dateText',
  link: 'div.title'
}

const BASE = 'https://site.test'

function pageHtml(options: { items?: number; next?: string | null } = {}): string {
  const count = options.items ?? 2
  const items = Array.from(
    { length: count },
    (_, index) => `<div class="item"><a href="/g/${index}">${index}</a></div>`
  ).join('')
  const next = options.next === null ? '' : `<a class="next" href="${options.next ?? '/page/2'}">next</a>`
  return `<html><body><div class="list">${items}</div>${next}</body></html>`
}

function mockFetch(handler: () => { ok: boolean; text: () => Promise<string> }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => handler() as unknown as Response)
  )
}

function okPage(html: string) {
  return { ok: true, text: async () => html }
}

function failPage() {
  return { ok: false, text: async () => '' }
}

function setupStores(): void {
  setActivePinia(createPinia())
  useSiteStore().setSite({ name: 'fake' } as never)
  useConfigStore().sites.set('fake', {
    loadThumbnailSwitch: true,
    scrollStatus: 1,
    smooth: 1,
    downloadMethod: 'miao',
    navigationPoint: 0,
    skipRead: false,
    lazyLimit: 100,
    onlyShowDownloadable: false
  })
}

function createHost(): WaterfallHost & {
  resolveElements: ReturnType<typeof vi.fn>
  onItemsAppended: ReturnType<typeof vi.fn>
  allLoadCompleted: ReturnType<typeof vi.fn>
  onScrollEvent: ReturnType<typeof vi.fn>
} {
  return {
    resolveElements: vi.fn<(elems: JQuery) => Promise<JQuery[]>>(async (elems) =>
      elems.toArray().map((e) => jquery(e))
    ),
    onItemsAppended: vi.fn<(items: JQuery[]) => void>(),
    allLoadCompleted: vi.fn<() => void>(),
    onScrollEvent: vi.fn<(height: number, top: number) => void>()
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Pagination', () => {
  it('拿到下一页：解析 nextUrl 与条目，并把链接改成新窗口', async () => {
    mockFetch(() => okPage(pageHtml({ items: 3, next: '/page/3' })))
    const page = new Pagination(selector, jquery(), BASE)
    page.nextUrl = '/page/2'

    await expect(page.fetchNext()).resolves.toBe('ok')

    expect(page.nextDetail?.length).toBe(3)
    expect(page.nextUrl).toBe('https://site.test/page/3')
    expect(jquery(page.nextDetail!).find('a').first().attr('target')).toBe('_blank')
  })

  it('最后一页没有 next 链接 → nextUrl 归 null，条目仍然有效', async () => {
    mockFetch(() => okPage(pageHtml({ items: 2, next: null })))
    const page = new Pagination(selector, jquery(), BASE)
    page.nextUrl = '/page/9'

    await expect(page.fetchNext()).resolves.toBe('ok')
    expect(page.nextUrl).toBeNull()
    expect(page.nextDetail?.length).toBe(2)
  })

  it('有 next 但抽不到条目 → blocked（限流页 / 结果上限）', async () => {
    mockFetch(() => okPage(pageHtml({ items: 0, next: '/page/3' })))
    const page = new Pagination(selector, jquery(), BASE)
    page.nextUrl = '/page/2'

    await expect(page.fetchNext()).resolves.toBe('blocked')
    expect(page.nextDetail).toBeNull()
  })

  it('404 后重试成功', async () => {
    let calls = 0
    mockFetch(() => (++calls === 1 ? failPage() : okPage(pageHtml({ items: 1, next: null }))))
    const page = new Pagination(selector, jquery(), BASE)
    page.nextUrl = '/page/2'

    await expect(page.fetchNext()).resolves.toBe('ok')
    expect(calls).toBe(2)
  })

  it('连续失败 → failed，尝试次数为重试次数 + 1', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return failPage()
    })
    const page = new Pagination(selector, jquery(), BASE)
    page.nextUrl = '/page/2'

    await expect(page.fetchNext()).resolves.toBe('failed')
    expect(calls).toBe(4)
  })

  it('已经落地时不再发请求', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const page = new Pagination(selector, jquery(), BASE)
    page.isEnd = true

    await expect(page.fetchNext()).resolves.toBe('end')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('nextUrl 为空 → end 并置 isEnd', async () => {
    const page = new Pagination(selector, jquery(), BASE)
    await expect(page.fetchNext()).resolves.toBe('end')
    expect(page.isEnd).toBe(true)
  })
})

describe('Waterfall', () => {
  beforeEach(() => {
    // 首屏自带一个「下一页」链接：appendNext 第一次调用要靠它解析出地址
    document.body.innerHTML =
      '<div class="list"><a class="next" href="/page/2">next</a></div><nav class="pagination"></nav>'
    setupStores()
  })

  it('追加下一页：条目进容器、回调站点、落地时通知', async () => {
    let calls = 0
    mockFetch(() => {
      calls++
      return calls === 1 ? okPage(pageHtml({ items: 2, next: '/page/3' })) : okPage(pageHtml({ items: 1, next: null }))
    })
    const host = createHost()
    const waterfall = new Waterfall(host, selector)

    await waterfall.appendNext()

    expect(jquery('div.list div.item').length).toBe(3)
    expect(host.onItemsAppended).toHaveBeenCalledTimes(2)
    expect(host.allLoadCompleted).toHaveBeenCalledTimes(1)
    expect(useSisterStore().sisterNumber).toBe(3)
    expect(waterfall.hasMore).toBe(false)
  })

  it('没有下一页就落地，之后再 appendNext 不再发请求也不再喊落地', async () => {
    document.body.innerHTML = '<div class="list"></div><nav class="pagination"></nav>'
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)
    const host = createHost()
    const waterfall = new Waterfall(host, selector)

    await waterfall.appendNext()
    await waterfall.appendNext()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(host.allLoadCompleted).toHaveBeenCalledTimes(1)
    expect(waterfall.hasMore).toBe(false)
  })
})
