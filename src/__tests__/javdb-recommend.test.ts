// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import jquery from 'jquery'
import { collapseRecommend, javdb_recommend_selector, javdb_selector } from '@/site/javdb/javdb'

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

const RECOMMEND_COUNT = 3
const MAIN_COUNT = 2

/** 复刻首页片段：推荐位与主列表都带 div.movie-list / div.item，只有容器 id 不同 */
function renderPage(options: { collapsed?: boolean } = {}): void {
  const recommendItems = Array.from(
    { length: RECOMMEND_COUNT },
    (_, i) => `<div class="item"><div class="video-title"><strong>RC-${i}</strong></div></div>`
  ).join('')
  const mainItems = Array.from(
    { length: MAIN_COUNT },
    (_, i) =>
      `<div class="item"><div class="video-title"><strong>SN-${i}</strong></div><div class="meta">2026-11-0${i + 1}</div></div>`
  ).join('')
  const collapsed = options.collapsed === true
  document.body.innerHTML = `
    <h1 class="title is-size-5" data-controller="recommend" data-cookie-key="expand_key_609" data-container-id="recommend-container">
      每週推薦(週一/四更新)&nbsp;
      <a class="links" data-action="click->recommend#collapse">
        <div class="text collapse" style="display: ${collapsed ? 'none' : 'block'};">收起到下次更新</div>
        <div class="text expand" style="display: ${collapsed ? 'block' : 'none'};">展開</div>
      </a>
      <span class="meta">更新於: 2026-11-02</span>
    </h1>
    <div class="movie-list cols-5 mb-4" id="recommend-container" style="display: ${collapsed ? 'none' : 'grid'};">
      ${recommendItems}
    </div>
    <div class="movie-list h cols-4 vcols-8">${mainItems}</div>
  `
}

/** 模拟站点的 recommend 控制器：点击后折叠容器并切换两段文字 */
function mockRecommendController(): ReturnType<typeof vi.fn> {
  const onClick = vi.fn(() => {
    const container = document.getElementById('recommend-container')
    if (container) container.style.display = 'none'
    const collapseText = document.querySelector(javdb_recommend_selector.collapseText)
    const expandText = document.querySelector('.text.expand')
    if (collapseText instanceof HTMLElement) collapseText.style.display = 'none'
    if (expandText instanceof HTMLElement) expandText.style.display = 'block'
  })
  document.querySelector(javdb_recommend_selector.collapseLink)?.addEventListener('click', onClick)
  return onClick
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('javdb · 每週推薦与懒加载列表', () => {
  it('列表容器只认主列表，推荐位的卡片不算条目', () => {
    renderPage()

    expect(jquery('.movie-list').length).toBe(2)
    expect(jquery(javdb_selector.container).length).toBe(1)
    expect(jquery(javdb_selector.container).find(javdb_selector.item).length).toBe(MAIN_COUNT)
    expect(jquery(javdb_selector.container).find(javdb_selector.item).first().text()).toContain('SN-0')
  })

  it('初始化时点站点的「收起到下次更新」，把推荐位收起来', () => {
    renderPage()
    const onClick = mockRecommendController()

    collapseRecommend()

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(document.getElementById('recommend-container')?.style.display).toBe('none')
  })

  it('已经收起时不再点：同一个链接点第二次会展开推荐位', () => {
    renderPage({ collapsed: true })
    const onClick = mockRecommendController()

    collapseRecommend()

    expect(onClick).not.toHaveBeenCalled()
  })

  it('站点控制器没接住时兜底隐藏，推荐位不占主列表位置', () => {
    renderPage()

    collapseRecommend()

    expect(document.getElementById('recommend-container')?.style.display).toBe('none')
  })

  it('页面上没有推荐位时什么都不做', () => {
    document.body.innerHTML = '<div class="movie-list h cols-4">' + '<div class="item"></div>' + '</div>'

    expect(() => collapseRecommend()).not.toThrow()
    expect(jquery(javdb_selector.container).length).toBe(1)
  })
})
