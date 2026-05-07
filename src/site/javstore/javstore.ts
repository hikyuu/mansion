import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import type { Info } from '@/store/sister-store'
import jquery from 'jquery'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { FORMAT, picx, WaterfallStatus } from '@/dictionary'
import { ElNotification } from 'element-plus'
import { haveArchived, upsertArchive } from '@/dao/archive'
import { downloadFromJavdb } from '@/site/javdb/javdb-api'
import dayjs from 'dayjs'
import { useSisterStore } from '@/store/sister-store'
import { useTaskStore } from '@/store/task-store.ts'
import { download } from '@/download'
import { useConfigStore } from '@/store/config-store.ts'
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
  pathDate: 'div.meta',
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

  mount(): void {
    this.addStyle()
    this.enableWaterfall()
  }

  checkSite(): boolean {
    return /(javstore)/i.test(document.URL)
  }

  private addStyle() {
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

  private enableWaterfall() {
    const item = jquery(this.selector.container).find(this.selector.item)
    if (!item.length) {
      return
    }
    if (!item[0]) return
    if (item[0].parentElement === null) {
      console.log('当前页面有变动,通知开发者')
      return
    }
    item[0].parentElement.id = 'waterfall'
    this.waterfall.flow(WaterfallStatus.lazy.code).then()
  }

  async resolveElements(elems: JQuery): Promise<JQuery[]> {
    if (/(javstore)/i.test(location.href) && elems) {
      const items = await this.filterReaded(elems)
      useTaskStore().addTasks(items)
      return items
    }
    return []
  }

  getOriginalId(item: JQuery): string | undefined {
    console.log(item.find(this.selector.serialNumber))
    const text = item.find(this.selector.serialNumber).text()

    const fc2reg = /fc2[-_ ]?ppv[-_ ]?([0-9]+)/i
    const matchFc2 = text.match(fc2reg)
    if (matchFc2) {
      return 'FC2PPV' + matchFc2[1]
    }

    const regex = /([a-z0-9]+)-([a-z0-9-]+)/i
    const match = text.match(regex)
    // console.log('提取原始ID', text, match)
    if (match) {
      return match[1] + '' + match[2]
    }

    return undefined
  }

  /**
   * 添加缩略图
   * @param serialNumber
   * @param item
   * @param type
   * @param onlyInfo
   */
  async processThumbnail(serialNumber: string, item: JQuery, type = 0, onlyInfo = false): Promise<void> {
    const info = this.buildInfo(item, serialNumber)

    await this.updateRepeat(serialNumber, info)

    // this.DeleteReadedNode(item, info)

    const thumbnail = this.creatThumbnail(serialNumber, item)

    const el_link = this.handleLink(item, serialNumber, type, info)

    if (onlyInfo) return

    const javstoreUrl = this.handleJavStoreDetail(serialNumber, thumbnail, item, el_link)

    const javstoreDetail = await this.handleDetail(javstoreUrl, serialNumber, thumbnail, el_link, item)

    this.resolveDate(javstoreDetail, serialNumber)

    this.resolveTitle(javstoreDetail, serialNumber)
    // 番号缩略大图
    await this.updateImgUrl(javstoreDetail, serialNumber, thumbnail, el_link, item, javstoreUrl)
  }

  private resolveDate(javstoreDetail: Document, serialNumber: string) {
    const dateRegex = /\d{4}[-/]\d{1,2}[-/]\d{1,2}/i
    const text = jquery(javstoreDetail).find('div.news').text()
    // console.log('解析发布日期文本', text)
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

  private handleJavStoreDetail(serialNumber: string, thumbnail: JQuery, item: JQuery, el_link: JQuery) {
    const javstoreUrl = item.find(this.selector.serialNumber).first().attr('href')
    if (!javstoreUrl) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: 404 })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: `无法找到JavStore详情页链接: ${serialNumber}`
      })
    } else {
      this.addLink('JavStore', el_link, serialNumber, item, javstoreUrl)
      useSisterStore().updateInfo({ serialNumber, javStoreUrl: javstoreUrl })
    }
    return javstoreUrl
  }

  allLoadCompleted(): void {
    this.hasLoadCompleted = true
  }

  updateInfo(item: JQuery, info: Info): void {
    // const parsedDate = dayjs(info.date)
    // if (parsedDate.isValid()) {
    //   const pathDate = parsedDate.format(FORMAT.PATH_DATE)
    //   useSisterStore().updateInfo({ serialNumber: info.serialNumber, pathDate })
    // }
  }

  async download(checkArchive: boolean) {
    const serialNumber = useSisterStore().current_key
    console.log('下载', serialNumber)
    if (!serialNumber) {
      ElNotification({ title: '提示', message: '没有选中', type: 'info' })
      return
    }
    
    if (this.downloadList.has(serialNumber)) {
      ElNotification({ title: '提示', message: '正在下载中', type: 'info' })
      return
    }

    this.downloadList.add(serialNumber)

    try {
      if (checkArchive && (await haveArchived(serialNumber))) {
        ElNotification({ title: '提示', message: '已经归档', type: 'info' })
        throw new Error('已经归档')
      }
    } catch (e) {
      this.downloadList.delete(serialNumber)
      return
    }
    
    return downloadFromJavdb(serialNumber)
      .then((r) => {
        if (r) {
          const magnet = r.attr('href')
          if (magnet === undefined) {
            ElNotification({ title: 'javdb', message: '没有找到磁力链接', type: 'error' })
            return false
          }
          download(magnet)
          upsertArchive(serialNumber)
          return true
        }
        return false
      })
      .catch((e) => {
        ElNotification.error({ title: 'javdb', message: e })
        return false
      })
      .finally(() => {
        this.downloadList.delete(serialNumber)
      })
  }

  showControlPanel(): boolean {
    return jquery(this.selector.container).length > 0
  }
}
