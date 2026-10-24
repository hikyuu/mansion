// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import jquery from 'jquery'
import { parseSister } from '@/site/sister-entry'
import { javdb_selector } from '@/site/javdb/javdb'
import { javstore_selector } from '@/site/javstore/javstore'
import { onejav_selector } from '@/site/onejav/onejav'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_addStyle: vi.fn<(css: string) => void>(),
  GM_cookie: { list: vi.fn<(details: unknown, cb: unknown) => void>() },
  monkeyWindow: {}
}))

vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))

/** 用某个站点的选择器解析一段 HTML 里的第一条妹妹 */
function parse(html: string, selector: typeof javdb_selector) {
  document.body.innerHTML = html
  return parseSister(jquery(selector.item).first(), selector)
}

describe('妹妹条目 · javdb', () => {
  it('番号取自标题元素，路径日期由日期文本推出', () => {
    const entry = parse(
      `<div class="movie-list h">
         <div class="item">
           <div class="video-title"><strong>ABF-274</strong></div>
           <div class="meta">2026-10-01</div>
           <div class="tags has-addons"></div>
         </div>
       </div>`,
      javdb_selector
    )

    expect(entry?.serialNumber).toBe('ABF274')
    expect(entry?.date).toBe('2026-10-01')
    expect(entry?.pathDate).toBe('/2026/10/01')
  })

  it('日期解析不出时 pathDate 为 undefined，而不是空串', () => {
    const entry = parse(
      `<div class="movie-list h">
         <div class="item">
           <div class="video-title"><strong>ABF-274</strong></div>
           <div class="meta">3 天前</div>
         </div>
       </div>`,
      javdb_selector
    )

    expect(entry?.date).toBe('3 天前')
    expect(entry?.pathDate).toBeUndefined()
  })
})

describe('妹妹条目 · javstore', () => {
  it('标题与番号写在同一段文本里，也能抽出番号', () => {
    const entry = parse(
      `<div class="category_news news_1n">
         <ul>
           <li>
             <h3><span><a href="/detail/1">【高清】ABF-274 某某作品</a></span></h3>
             <div class="meta">2026-10-01</div>
           </li>
         </ul>
       </div>`,
      javstore_selector
    )

    expect(entry?.serialNumber).toBe('ABF274')
  })

  it('列表页拿不到路径日期，留给详情页补', () => {
    const entry = parse(
      `<div class="category_news news_1n">
         <ul>
           <li>
             <h3><span><a href="/detail/1">ABF-274</a></span></h3>
             <div class="meta">2026-10-01</div>
           </li>
         </ul>
       </div>`,
      javstore_selector
    )

    expect(entry?.pathDate).toBeUndefined()
  })
})

describe('妹妹条目 · onejav', () => {
  it('路径日期取日期链接的 href', () => {
    document.body.innerHTML = `
      <div class="container">
        <div class="card mb-3">
          <h5 class="title is-4 is-spaced"><a href="/torrent/abf274">ABF-274</a></h5>
          <p class="subtitle"><a href="/2026/10/01">2026/10/01</a></p>
        </div>
      </div>`

    const entry = parseSister(jquery('div.card.mb-3').first(), onejav_selector)

    expect(entry?.serialNumber).toBe('ABF274')
    expect(entry?.date).toBe('2026/10/01')
    expect(entry?.pathDate).toBe('/2026/10/01')
  })
})

describe('妹妹条目 · 认不出番号', () => {
  it('返回 undefined，调用方据此跳过这条妹妹', () => {
    document.body.innerHTML = `
      <div class="movie-list h">
        <div class="item">
          <div class="video-title"><strong></strong></div>
          <div class="meta">2026-10-01</div>
        </div>
      </div>`

    expect(parseSister(jquery('div.item').first(), javdb_selector)).toBeUndefined()
  })
})
