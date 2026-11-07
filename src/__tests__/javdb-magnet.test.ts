// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import jquery from 'jquery'
import { absoluteDetailUrl, pickMagnet } from '@/site/javdb/javdb-api'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_cookie: { list: vi.fn<(details: unknown, cb: unknown) => void>() },
  monkeyWindow: {}
}))

/** 新版详情页的一条磁力：链接在 div.magnet-name 里，质量标记是 div.tags 下的 span.tag */
function magnetItem(href: string, name: string, tags: string[] = []): string {
  const tagsHtml =
    tags.length === 0
      ? ''
      : `<div class="tags">${tags
          .map((tag) => `<span class="tag is-primary is-small is-light">${tag}</span>`)
          .join('')}</div>`
  return `<div class="item odd" data-rank="0" data-size="4219" data-files="0" data-date="20261101">
      <div class="magnet-name">
        <a href="${href}" title="右鍵點擊並選擇「複製鏈接地址」">
          <span class="name">${name}</span>
          ${tagsHtml}
          <span class="meta">4.12GB</span>
        </a>
      </div>
      <div class="date"><span class="time">2026-11-01</span></div>
      <div class="buttons">
        <button class="button is-info is-small copy-to-clipboard" data-clipboard-text="${href}" type="button">複製</button>
        <a class="button is-info is-small" href="https://keepshare.org/aa36p03v/x" target="_blank">下載</a>
      </div>
    </div>`
}

/** 详情页文档：容器里混着广告、排序控件与磁力条目 */
function detailDoc(items: string): JQuery {
  return jquery(`<div>
      <div id="magnets-content" class="magnet-links">
        <div class="sda-content"><a href="https://t.jopeki.com/?pid=12"><img src="ad.jpg"></a></div>
        <div class="magnet-sort">
          <span class="select is-small"><select><option value="default">預設排序</option></select></span>
        </div>
        ${items}
      </div>
    </div>`)
}

describe('javdb 详情链接归一化', () => {
  it('相对路径补成 baseUrl 下的绝对地址', () => {
    expect(absoluteDetailUrl('/v/G7MJ')).toBe('https://javdb.com/v/G7MJ')
  })

  it('列表页给的绝对地址不再重复拼接 baseUrl', () => {
    expect(absoluteDetailUrl('https://javdb.com/v/G7MJ')).toBe('https://javdb.com/v/G7MJ')
    expect(absoluteDetailUrl('  https://javdb.com/v/G7MJ?x=1  ')).toBe('https://javdb.com/v/G7MJ?x=1')
  })

  it('协议相对与带查询串的链接', () => {
    expect(absoluteDetailUrl('//javdb.com/v/G7MJ')).toBe('https://javdb.com/v/G7MJ')
    expect(absoluteDetailUrl('/v/G7MJ?locale=zh')).toBe('https://javdb.com/v/G7MJ?locale=zh')
  })
})

describe('javdb 详情页挑磁力 · 高分 → 标签最多 → 第一个', () => {
  it('没有高分条目时取标签最多的那条，标签并列取页面上第一条', async () => {
    const doc = detailDoc(
      magnetItem('magnet:?xt=urn:btih:first', 'FC2PPV-5001994.torrent', ['高清']) +
        magnetItem('magnet:?xt=urn:btih:second', 'FC2-PPV-5001994', ['高清']) +
        magnetItem('magnet:?xt=urn:btih:third', 'FC2PPV-5001994')
    )

    const best = await pickMagnet(doc)

    expect(best.magnet.attr('href')).toBe('magnet:?xt=urn:btih:first')
  })

  it('标签多的排在前：一条高清 + 一条高清带字幕，取后者的标签数优势', async () => {
    const doc = detailDoc(
      magnetItem('magnet:?xt=urn:btih:one', 'ABP-123', ['高清']) +
        magnetItem('magnet:?xt=urn:btih:two', 'ABP-123', ['高清', '字幕'])
    )

    const best = await pickMagnet(doc)

    expect(best.magnet.attr('href')).toBe('magnet:?xt=urn:btih:two')
  })

  it('名字里带 -c（中文字幕）的算高分，压过标签更多的条目', async () => {
    const doc = detailDoc(
      magnetItem('magnet:?xt=urn:btih:plain', 'ABP-123', ['高清', '字幕']) +
        magnetItem('magnet:?xt=urn:btih:sub', 'ABP-123-C.torrent')
    )

    const best = await pickMagnet(doc)

    expect(best.magnet.attr('href')).toBe('magnet:?xt=urn:btih:sub')
  })

  it('广告与排序控件不算磁力条目', async () => {
    const doc = detailDoc(magnetItem('magnet:?xt=urn:btih:only', 'ABP-123'))

    const best = await pickMagnet(doc)

    expect(best.magnet.attr('href')).toBe('magnet:?xt=urn:btih:only')
  })

  it('旧版布局（div.item.columns.is-desktop，没有 data-rank）仍然认得出条目', async () => {
    const legacyItem = `<div class="item columns is-desktop">
        <div class="magnet-name column is-four-fifths">
          <a href="magnet:?xt=urn:btih:legacy">
            <span class="name">ABP-123-C</span>
            <span class="meta">1.2GB, 1個文件</span>
          </a>
        </div>
        <div class="date column"><span class="time">2026-10-01</span></div>
      </div>`

    const best = await pickMagnet(detailDoc(legacyItem))

    expect(best.magnet.attr('href')).toBe('magnet:?xt=urn:btih:legacy')
    expect(best.score).toBe(1)
  })

  it('页面上没有详情页骨架 → 说明「详情页没拿到」，而不是「没有磁力」', async () => {
    const doc = jquery('<div><body>Just a moment...</body></div>')

    await expect(pickMagnet(doc)).rejects.toBe(
      'javdb 详情页没拿到（缺少详情页骨架，可能是拦截页或需要登录）'
    )
  })

  it('骨架在、磁力区块不在 → 说明该作品暂无磁链', async () => {
    const doc = jquery('<div><div class="video-detail"><h2 class="title">DLDSS-578</h2></div></div>')

    await expect(pickMagnet(doc)).rejects.toBe('javdb 详情页没有磁力区块（该作品暂无磁链）')
  })

  it('有磁力区块但没有可用条目 → 原因带条目数', async () => {
    await expect(pickMagnet(detailDoc(''))).rejects.toBe(
      '没有找到磁力链接（容器内 0 个条目均无 magnet: 链接）'
    )
  })
})
