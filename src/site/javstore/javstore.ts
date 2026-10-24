import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import jquery from 'jquery'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { FORMAT, WaterfallStatus } from '@/dictionary'
import { downloadFromJavdb } from '@/site/javdb/javdb-api'
import dayjs from 'dayjs'
import { useSisterStore } from '@/store/sister-store'
import { useConfigStore } from '@/store/config-store.ts'
import { submitDownload } from '@/download/intent'
import { ProjectError } from '@/common/errors.ts'
import { SiteId } from '@/site/site-id'

export const JAVSTORE_NAME = 'javstore'

export const javstore_selector: Selector = {
  next: '.phan_trang a[title="Next"]',
  container: 'div.category_news.news_1n>ul',
  item: 'li',
  pagination: 'div.phan_trang',
  serialNumber: 'h3 span a',
  date: 'div.meta',
  link: 'h3'
}

export class Javstore extends SiteAbstract {
  public name = JAVSTORE_NAME
  public siteId = SiteId.JAVSTORE
  public waterfall: Waterfall
  constructor() {
    super()
    this.waterfall = new Waterfall(this, this.selector)
  }

  selector: Selector = javstore_selector

  theme = {
    PRIMARY_COLOR: '#2f7feb',
    SECONDARY_COLOR: '#f5f5f5',
    WARNING_COLOR: '#fadd65'
  }

  /** javstore 的页数多，一律懒加载 */
  protected waterfallStatus(): number | null {
    return WaterfallStatus.lazy.code
  }

  protected addStyle() {
    if (!useConfigStore().getSiteConfig.loadThumbnailSwitch) {
      return
    }
    const currentPath = window.location.pathname
    const isHomePage = currentPath === '/' || currentPath === '/index.html' // 根据你的实际首页路径调整
    GM_addStyle(`
      .mansion_javstore {
        width: 100%;
        display: flex;
        justify-content: center; /* 水平居中 */
      }
      .category_news_main_right .news_1n > ul li {
        width: 100%;
      }
    `)
    if (!isHomePage) {
      jquery('.boxoleft').remove()
      jquery('.category_news_left_side').remove()
      jquery('.all_page_javstore1').removeClass('all_page_javstore1').addClass('mansion_javstore')
      jquery('.boxoright,.category_news_main_right').css('width', 'auto')
      jquery('.boxoright').css({
        width: '1344px',
        margin: 'auto'
      })
    }
    console.log(`样式添加成功`)
  }

  /**
   * javstore 的条目链接本身就是详情页，不需要按 sortId 搜索。
   * 返回 null 由 pipeline 记为终态 404（该站没有别的变体可试）。
   */
  async lookupJavstore(item: JQuery): Promise<string | null> {
    return item.find(this.selector.serialNumber).first().attr('href') ?? null
  }

  /** 详情页补发布日期（其余站点从列表页取日期） */
  onDetail(detail: Document, serialNumber: string): void {
    this.resolveDate(detail, serialNumber)
  }

  private resolveDate(javstoreDetail: Document, serialNumber: string) {
    const dateRegex = /\d{4}[-/]\d{1,2}[-/]\d{1,2}/i
    const text = jquery(javstoreDetail).find('div.news').text()
    const matches = text.match(dateRegex)
    if (matches && matches.length > 0) {
      console.log('解析发布日期结果', matches[0])
      const date = dayjs(matches[0])
      if (!date.isValid()) {
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: `无法解析发布日期: ${serialNumber} 日期字符串: ${matches[0]}`
        })
      }
      useSisterStore().updateInfo({
        serialNumber,
        date: matches[0],
        pathDate: date.format(FORMAT.PATH_DATE)
      })
    }
  }

  async download(checkArchive: boolean): Promise<void> {
    const serialNumber = useSisterStore().current_key
    await submitDownload({
      serialNumber,
      checkArchive,
      resolveSource: async () => {
        if (!serialNumber) return null
        console.log('下载', serialNumber)
        const magnet = await downloadFromJavdb(serialNumber)
        return magnet?.attr('href') ?? null
      }
    })
  }
}
