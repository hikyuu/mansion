import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import type { Info } from '@/store/sister-store'
import jquery from 'jquery'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { FORMAT, WaterfallStatus } from '@/dictionary'
import { ElNotification } from 'element-plus'
import { haveArchived, upsertArchive } from '@/dao/archive'
import { downloadFromLocal, getDetailHref } from '@/site/javdb/javdb-api'
import dayjs from 'dayjs'
import { useSisterStore } from '@/store/sister-store'
import { useTaskStore } from '@/store/task-store.ts'
import { download } from '@/download'
import { useConfigStore } from '@/store/config-store.ts'

export const JAVDB_NAME = 'javdb'

export const javdb_selector: Selector = {
  next: 'a.pagination-next',
  container: 'div.movie-list.h.cols-4',
  item: 'div.item',
  pagination: 'nav.pagination',
  serialNumber: 'div.video-title strong',
  date: 'div.meta',
  pathDate: 'div.meta',
  link: 'div.tags.has-addons'
}

export class Javdb extends SiteAbstract {
  public name = JAVDB_NAME
  public siteId = 2
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

  mount(): void {
    this.addStyle()
    this.enableWaterfall()
  }

  checkSite(): boolean {
    return /(javdb)/g.test(document.URL)
  }

  private addStyle() {
    if (!useConfigStore().getSiteConfig.loadThumbnailSwitch) {
      return
    }
    GM_addStyle(`.movie-list{display: flex;flex-direction: column;} .max{width:100%} .min{width:100%} 
        .movie-list .item .cover { position: relative; padding-top: 15%; background: white;}`)
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
    if (/(javdb)/g.test(location.href) && elems) {
      const items = await this.filterReaded(elems)
      useTaskStore().addTasks(items)
      return items
    }
    return []
  }

  allLoadCompleted(): void {
    this.hasLoadCompleted = true
  }

  updateInfo(item: JQuery, info: Info): void {
    const parsedDate = dayjs(info.date)
    if (parsedDate.isValid()) {
      const pathDate = parsedDate.format(FORMAT.PATH_DATE)
      useSisterStore().updateInfo({ serialNumber: info.serialNumber, pathDate })
    }
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
    const detailHref = getDetailHref(jquery('#' + serialNumber))

    try {
      if (checkArchive && (await haveArchived(serialNumber))) {
        ElNotification({ title: '提示', message: '已经归档', type: 'info' })
        throw new Error('已经归档')
      }
      if (detailHref === undefined) {
        ElNotification({ title: '提示', message: '没有找到详情页', type: 'info' })
        this.downloadList.delete(serialNumber)
        throw new Error('没有找到详情页')
      }
    } catch (e) {
      this.downloadList.delete(serialNumber)
      return
    }

    downloadFromLocal(detailHref)
      .then((r) => {
        if (r) {
          const magnet = r.attr('href')
          if (magnet === undefined) {
            ElNotification({ title: 'javdb', message: '没有找到磁力链接', type: 'error' })
            return
          }
          download(magnet)
        }
      })
      .catch((e) => {
        ElNotification.error({ title: 'javdb', message: e })
      })
      .finally(() => {
        upsertArchive(serialNumber)
        this.downloadList.delete(serialNumber)
      })
  }

  // save(serialNumber: string): void {
  //   const info = this.sister.getInfo(serialNumber)
  //   if (!info) return
  //   console.log(info.pathDate)
  //   if (info.haveRead) {
  //     console.log('已经记录', serialNumber)
  //     return
  //   }
  //   const pathDate = info.pathDate
  //   if (pathDate === undefined || pathDate === '') {
  //     ElNotification({ title: '提示', message: `${serialNumber}日期格式有变动`, type: 'error' })
  //     return
  //   }
  //
  //   uploadHistory(serialNumber, info).then((history) => {
  //     console.log('上传成功', history)
  //     useSisterStore().updateInfo({ serialNumber, haveRead: true, status: 200 })
  //   })
  // }

  showControlPanel(): boolean {
    return jquery(this.selector.container).length > 0
  }
}
