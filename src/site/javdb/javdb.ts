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
 *
 * 但「每週推薦」区块也用 `div.movie-list`（`cols-5 mb-4`），卡片同样是 `div.item`，
 * 只是没有日期与磁链标签 —— 不排掉它，推荐位会被当成懒加载列表的一部分
 * （条数虚高、瀑布流锚点可能落错容器、缩略图链路去解析没有日期的卡片）。
 * 推荐位有稳定的 `#recommend-container`，用 id 排除比写死列数类更可靠。
 */
export const javdb_selector: Selector = {
  next: 'a.pagination-next',
  container: 'div.movie-list:not(#recommend-container)',
  item: 'div.item',
  pagination: 'nav.pagination',
  serialNumber: 'div.video-title strong',
  date: 'div.meta',
  pathDateFrom: 'dateText',
  link: 'div.tags.has-addons'
}

/**
 * 详情页磁力区块选择器
 * - 磁力条目只认 `div.item`：新版是 `div.item[data-rank]`，旧版是 `div.item.columns.is-desktop`，
 *   把 `data-rank` 写进选择器会让还在旧版页面的条目一条都匹配不上
 * - 容器内混有广告（div.sda-content）与排序控件（div.magnet-sort），两者都不是 div.item
 * - 磁力链接以 magnet: 开头，据此排除「複製」「下載」按钮
 * - 质量标记从名字后缀搬到了 div.tags 下的 span.tag（如 高清），挑选磁力时按它数标签
 */
export const javdb_detail_selector = {
  magnetsContainer: '#magnets-content',
  magnetItem: 'div.item',
  magnetLink: 'a[href^="magnet:"]',
  magnetName: 'span.name',
  magnetTags: 'div.tags span.tag',
  /** 详情页骨架：磁力区块缺失时用它区分「该作品没有磁链」与「页面根本没拿到」 */
  detailSkeleton: 'div.video-detail, div.movie-panel-info'
}

/**
 * 「每週推薦」区块的选择器
 * - 标题 h1 上带 `data-container-id` / `data-cookie-key`，折叠状态由站点的 recommend 控制器写进 cookie
 * - 折叠链接上是 `click->recommend#collapse`；同一链接收起后变成「展開」，点错会把推荐位点开
 */
export const javdb_recommend_selector = {
  container: '#recommend-container',
  collapseLink: 'a[data-action*="recommend#collapse"]',
  collapseText: '.text.collapse'
}

/** 元素是否已经被隐藏（站点控制器收起时挂的是内联 display:none，不依赖布局测量） */
function isHidden(element: Element): boolean {
  if ((element as HTMLElement).hidden) return true
  return window.getComputedStyle(element).display === 'none'
}

/**
 * 收起「每週推薦」：点站点自己的「收起到下次更新」，而不是把容器藏起来。
 * 站点控制器会把折叠状态写进 cookie（键名挂在 h1[data-cookie-key] 上，跟着每周一/四的更新轮次走），
 * 所以收起后一直生效到下一次更新，脚本不用自己记状态。
 */
export function collapseRecommend(): void {
  const container = jquery<HTMLElement>(javdb_recommend_selector.container)[0]
  if (container === undefined || isHidden(container)) return
  const link = jquery<HTMLElement>(javdb_recommend_selector.collapseLink)[0]
  if (link === undefined) return
  // 只有当前处于展开态才点：收起态再点一次会展开推荐位
  const collapseText = jquery(link).find(javdb_recommend_selector.collapseText)[0]
  if (collapseText !== undefined && isHidden(collapseText)) return
  link.click()
  // 控制器没接上（脚本先于站点 JS 执行）时兜个底，至少别让推荐位占着主列表位置
  if (!isHidden(container)) container.style.display = 'none'
  console.log('每週推薦已收起到下次更新')
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

  /**
   * 初始化先收起「每週推薦」再挂瀑布流：推荐位的卡片不是列表条目，
   * 收起后主列表才是页面上唯一的列表容器。
   */
  mount(): void {
    collapseRecommend()
    super.mount()
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
        // 用 getElementById 而不是 `#番号`：番号里可能带会破坏选择器的字符，
        // 选择器语法错误会直接抛进下载意图、被报成「解析下载地址失败」
        const card = document.getElementById(serialNumber)
        if (card === null) return null
        console.log('下载', serialNumber)
        const detailHref = getDetailHref(jquery(card))
        if (detailHref === undefined) return null
        const magnet = await downloadFromLocal(detailHref)
        const url = magnet?.attr('href')
        if (!url) throw new Error('javdb 详情页没有磁力链接')
        return { url, source: { label: 'javdb 磁力', origin: 'javdb' } }
      }
    })
  }

}
