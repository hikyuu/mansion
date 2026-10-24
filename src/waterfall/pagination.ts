import jquery from 'jquery'
import type { Selector } from '@/waterfall/waterfall'

/** 一页的抓取结局，提示与落地由 Waterfall 决定 */
export type PageOutcome =
  /** 拿到下一页目录，nextDetail / nextUrl 已更新 */
  | 'ok'
  /** 没有下一页了 */
  | 'end'
  /** 还有下一页链接但抽不到条目：限流页 / 验证页 / 结果上限 */
  | 'blocked'
  /** 重试耗尽 */
  | 'failed'

const RETRY_LIMIT = 3

/** 抽出条目，并把条目内链接改成新窗口打开 */
export function extractItems(doc: Document, selector: Selector): JQuery {
  const details = jquery(doc).find(selector.container + ' ' + selector.item)
  for (const elem of details) {
    const links = elem.getElementsByTagName('a')
    for (let i = 0; i < links.length; i++) {
      links[i]!.target = '_blank'
    }
  }
  return details
}

/** 解析下一页链接：取最后一个（部分站点头尾各有一个 next，如 #unext / #dnext） */
export function resolveNextUrl(doc: Document, selector: Selector, baseURI: string): string | null {
  const href = jquery(doc).find(selector.next).last().attr('href')
  if (href === undefined || href === null) return null
  const a = document.createElement('a')
  a.href = href
  return `${baseURI}${a.pathname}${a.search}`
}

/**
 * 分页源：负责「下一页在哪」与「怎么把它取回来解析」。
 * 只关心抓取与解析，不碰 DOM 追加、不弹通知 —— 那些是 Waterfall 的职责。
 */
export class Pagination {
  currentURL: string = location.toString()
  pathname: string = location.pathname
  isEnd = false
  nextUrl: string | null = null
  detail: JQuery
  nextDetail: JQuery | null = null

  constructor(
    private readonly selector: Selector,
    detail: JQuery,
    private readonly baseURI: string
  ) {
    this.detail = detail
  }

  /** 取下一页；成功时更新 nextUrl / nextDetail */
  async fetchNext(retry: number = RETRY_LIMIT): Promise<PageOutcome> {
    if (this.isEnd) return 'end'
    if (this.nextUrl === null) {
      this.isEnd = true
      return 'end'
    }

    try {
      const response = await fetch(this.nextUrl, { credentials: 'same-origin' })
      if (!response.ok) {
        console.log('重试获取下一页:状态错误', this.nextUrl)
        if (retry > 0) return this.fetchNext(--retry)
        console.log('重试次数用尽')
        return 'failed'
      }
      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const nextUrl = resolveNextUrl(doc, this.selector, this.baseURI)
      const detail = extractItems(doc, this.selector)
      if (detail.length === 0 && nextUrl !== null) {
        console.error('瀑布流: 下一页没有条目，判定为受限或已到上限', this.nextUrl)
        return 'blocked'
      }
      this.nextUrl = nextUrl
      this.nextDetail = detail
      return 'ok'
    } catch (reason) {
      console.error(reason)
      if (retry > 0) {
        console.log('重试获取下一页:报错', this.nextUrl)
        return this.fetchNext(--retry)
      }
      console.log('重试次数用尽')
      return 'failed'
    }
  }
}
