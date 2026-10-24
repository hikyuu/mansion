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

export const javdb_selector: Selector = {
  next: 'a.pagination-next',
  container: 'div.movie-list.h.cols-4',
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
        return { url, source: { label: 'javdb 磁力' } }
      }
    })
  }

}
