import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { WaterfallStatus } from '@/dictionary'
import { downloadFromLocal, getDetailHref } from '@/site/javdb/javdb-api'
import { useSisterStore } from '@/store/sister-store'
import { useConfigStore } from '@/store/config-store.ts'
import { submitDownload } from '@/download/intent'
import { SiteId } from '@/site/site-id'

export const JAVDB_NAME = 'javdb'

/** 当前条目往上的已读卡片窗口：窗口外的更早已读卡片从 DOM 里清掉 */
export const READ_CARD_LIMIT = 20

/**
 * 列表根节点只认 `movie-list`：普通列表页带 `h cols-4`，
 * FC2 专题页（/fc2）的根节点只有 `movie-list` 一个类，写死列数类会让整页认不到妹妹。
 */
export const javdb_selector: Selector = {
  next: 'a.pagination-next',
  container: 'div.movie-list',
  item: 'div.item',
  pagination: 'nav.pagination',
  serialNumber: 'div.video-title strong',
  date: 'div.meta',
  pathDateFrom: 'dateText',
  link: 'div.tags.has-addons'
}

/**
 * 详情页磁力区块选择器
 * - 新版详情页的磁力条目为 div.item[data-rank]，不再带 columns/is-desktop
 * - 容器内混有广告（div.sda-content），磁力链接需以 magnet: 开头区分
 */
export const javdb_detail_selector = {
  magnetsContainer: '#magnets-content',
  magnetItem: 'div.item',
  magnetLink: 'a[href^="magnet:"]',
  magnetName: 'span.name'
}

export class Javdb extends SiteAbstract {
  public name = JAVDB_NAME
  public siteId = SiteId.JAVDB
  public waterfall: Waterfall
  constructor() {
    super()
    this.waterfall = new Waterfall(this, this.selector)
  }

  selector: Selector = javdb_selector

  theme = {
    PRIMARY_COLOR: '#2f7feb',
    SECONDARY_COLOR: '#f5f5f5',
    WARNING_COLOR: '#fadd65'
  }

  /** javdb 的页数多，一律懒加载 */
  protected waterfallStatus(): number | null {
    return WaterfallStatus.lazy.code
  }

  protected addStyle() {
    if (!useConfigStore().getSiteConfig.loadThumbnailSwitch) {
      return
    }
    GM_addStyle(`.movie-list{display: flex;flex-direction: column;} .max{width:100%} .min{width:100%} 
        .movie-list .item .cover { position: relative; padding-top: 15%; background: white;}`)
    console.log(`样式添加成功`)
  }

  /**
   * 视口稳定后裁卡片：当前条目连同它上方 READ_CARD_LIMIT 条留在页面上，
   * 位置更早的已读卡片清掉。当前条目没越过窗口时一条都不删 —— 用户可能正停在列表上方。
   * 未读卡片一张不动 —— 它们还没被看过，删掉等于丢内容。
   */
  onViewportSettled(): void {
    const overflow = this.sister.readOverflow(READ_CARD_LIMIT)
    if (overflow.length === 0) return
    this.removeReadCards(overflow)
  }

  /**
   * 移除已读卡片，并让 store 与 DOM 对齐（队列、番号集合、妹妹数一起减）。
   * 删的多半是当前视口上方的卡片，页面会整体上移，所以按当前条目补偿滚动位置。
   */
  private removeReadCards(serialNumbers: string[]): void {
    const container = jquery(this.selector.container)[0]
    const current = this.sister.current_key ? document.getElementById(this.sister.current_key) : null
    const beforeTop = current?.getBoundingClientRect().top
    let removed = 0

    serialNumbers.forEach((serialNumber) => {
      const node = document.getElementById(serialNumber)
      // 只删列表容器里的卡片：同 id 的元素可能属于页面别处（弹窗、推荐位）
      if (node === null || container === undefined || !container.contains(node)) return
      node.remove()
      removed++
    })

    if (current !== null && beforeTop !== undefined) {
      const delta = current.getBoundingClientRect().top - beforeTop
      // 必须 instant：站点若开了 scroll-behavior: smooth，补偿会变成一段可见的滚动动画
      if (delta !== 0) window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' })
    }

    // 卡片可能早已不在 DOM（上一次裁过），store 记录照样要清，否则窗口永远溢出
    this.sister.forgetRead(serialNumbers)
    this.waterfall.setSisterNumber()
    console.log(`已读卡片只留当前条目及上方 ${READ_CARD_LIMIT} 条，移除 ${removed} 张`)
  }

  async download(checkArchive: boolean): Promise<void> {
    const serialNumber = useSisterStore().current_key
    await submitDownload({
      serialNumber,
      checkArchive,
      resolveSource: async () => {
        if (!serialNumber) return null
        console.log('下载', serialNumber)
        const detailHref = getDetailHref(jquery('#' + serialNumber))
        if (detailHref === undefined) return null
        const magnet = await downloadFromLocal(detailHref)
        const url = magnet?.attr('href')
        if (!url) throw new Error('javdb 详情页没有磁力链接')
        return { url, source: { label: 'javdb 磁力', origin: 'javdb' } }
      }
    })
  }

}
