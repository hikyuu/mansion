// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import jquery from 'jquery'
import { Javdb, READ_CARD_LIMIT } from '@/site/javdb/javdb'
import { useSisterStore } from '@/store/sister-store'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_addStyle: vi.fn<(css: string) => void>(),
  monkeyWindow: {}
}))

vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))

vi.mock('@/download/intent', () => ({ submitDownload: vi.fn<() => Promise<void>>() }))

vi.mock('@/site/javdb/javdb-api', () => ({
  downloadFromLocal: vi.fn<() => Promise<JQuery | undefined>>(),
  getDetailHref: vi.fn<() => string | undefined>()
}))

const READ_COUNT = 25
const UNREAD_COUNT = 3

function serial(index: number): string {
  return `SN-${String(index).padStart(2, '0')}`
}

/** 页面上 READ_COUNT 条已读卡片 + UNREAD_COUNT 条未读卡片 */
function renderPage(reads = READ_COUNT): void {
  const cards = Array.from({ length: reads + UNREAD_COUNT }, (_, i) => {
    const index = i + 1
    return `<div class="item" id="${serial(index)}"><div class="video-title"><strong>${serial(index)}</strong></div></div>`
  })
  document.body.innerHTML = `<div class="movie-list h cols-4">${cards.join('')}</div>`
}

/** 把页面上的卡片灌进 store，最后一条已读是当前条目 */
function fillStore(reads = READ_COUNT): void {
  const sister = useSisterStore()
  for (let i = 1; i <= reads; i++) {
    sister.updateInfo({ serialNumber: serial(i), haveRead: true })
  }
  for (let i = 0; i < UNREAD_COUNT; i++) {
    sister.updateInfo({ serialNumber: serial(reads + i + 1), haveRead: false })
  }
  sister.setCurrent(serial(reads))
}

function setup(reads = READ_COUNT): Javdb {
  setActivePinia(createPinia())
  renderPage(reads)
  fillStore(reads)
  return new Javdb()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('javdb · 已读卡片窗口', () => {
  it('当前条目越过 20 条窗口时，移除窗口之前的已读卡片', () => {
    const site = setup()
    const sister = useSisterStore()

    site.onViewportSettled()

    expect(sister.haveReadNumber).toBe(READ_CARD_LIMIT)
    expect(document.getElementById(serial(1))).toBeNull()
    expect(document.getElementById(serial(5))).toBeNull()
    expect(document.getElementById(serial(6))).not.toBeNull()
    expect(document.getElementById(serial(READ_COUNT))).not.toBeNull()
  })

  it('窗口跟着当前条目走：当前条目越靠下，裁掉的越早', () => {
    const site = setup(30)
    const sister = useSisterStore()

    site.onViewportSettled()

    expect(document.getElementById(serial(10))).toBeNull()
    expect(document.getElementById(serial(11))).not.toBeNull()
    expect(sister.getInfo(serial(1))).toBeUndefined()
    expect(sister.current_index).toBe(READ_CARD_LIMIT - 1)
  })

  it('当前条目没越过窗口时，已读再多也一条不裁', () => {
    const site = setup()
    const sister = useSisterStore()
    sister.setCurrent(serial(5))

    site.onViewportSettled()

    expect(jquery('.movie-list .item').length).toBe(READ_COUNT + UNREAD_COUNT)
    expect(sister.haveReadNumber).toBe(READ_COUNT)
    expect(sister.current_key).toBe(serial(5))
  })

  it('窗口外的未读卡片保留：位置触发，但没看过的内容不丢', () => {
    setActivePinia(createPinia())
    renderPage()
    const sister = useSisterStore()
    for (let i = 1; i <= READ_COUNT; i++) {
      sister.updateInfo({ serialNumber: serial(i), haveRead: i > 3 })
    }
    for (let i = 0; i < UNREAD_COUNT; i++) {
      sister.updateInfo({ serialNumber: serial(READ_COUNT + i + 1), haveRead: false })
    }
    sister.setCurrent(serial(READ_COUNT))
    const site = new Javdb()

    site.onViewportSettled()

    expect(document.getElementById(serial(3))).not.toBeNull()
    expect(sister.getInfo(serial(3))).toBeDefined()
    expect(document.getElementById(serial(4))).toBeNull()
    expect(document.getElementById(serial(5))).toBeNull()
    expect(sister.current_index).toBe(READ_COUNT - 3)
  })

  it('未读卡片一张不动', () => {
    const site = setup()

    site.onViewportSettled()

    for (let i = 1; i <= UNREAD_COUNT; i++) {
      expect(document.getElementById(serial(READ_COUNT + i))).not.toBeNull()
    }
    expect(jquery('.movie-list .item').length).toBe(READ_CARD_LIMIT + UNREAD_COUNT)
  })

  it('store 与 DOM 对齐：队列、番号集合与当前下标一起收窄', () => {
    const site = setup()
    const sister = useSisterStore()

    site.onViewportSettled()

    expect(sister.getInfo(serial(1))).toBeUndefined()
    expect(sister.size).toBe(READ_CARD_LIMIT + UNREAD_COUNT)
    expect(sister.sisterNumber).toBe(READ_CARD_LIMIT + UNREAD_COUNT)
    expect(sister.current_key).toBe(serial(READ_COUNT))
    expect(sister.current_index).toBe(READ_CARD_LIMIT - 1)
  })

  it('刚好 20 条已读时什么都不删', () => {
    const site = setup(READ_CARD_LIMIT)

    site.onViewportSettled()

    expect(jquery('.movie-list .item').length).toBe(READ_CARD_LIMIT + UNREAD_COUNT)
    expect(useSisterStore().haveReadNumber).toBe(READ_CARD_LIMIT)
  })

  it('当前条目即使是最早的已读，也不会被删掉', () => {
    const site = setup(READ_CARD_LIMIT + 1)
    const sister = useSisterStore()
    sister.setCurrent(serial(1))

    site.onViewportSettled()

    expect(document.getElementById(serial(1))).not.toBeNull()
    expect(sister.getInfo(serial(1))).toBeDefined()
    expect(sister.current_key).toBe(serial(1))
  })
})
