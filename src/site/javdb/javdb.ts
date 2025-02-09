import { SiteAbstract } from '@/site/site-abstract'
import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import type { Info } from '@/store/sister-store'
import $ from 'jquery'
import { Task } from '@/site/task'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { useConfigStore } from '@/store/config-store'
import { FORMAT, WaterfallStatus } from '@/dictionary'
import { ElNotification } from 'element-plus'
import { haveArchived, upsertArchive } from '@/dao/archive'
import { clickMagnet } from '@/site/onejav/onejav'
import { downloadFromLocal, getDetailHref } from '@/site/javdb/javdb-api'
import { uploadHistory } from '@/dao/browse-history'
import dayjs from 'dayjs'
import { useSisterStore } from '@/store/sister-store'

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
  public name = 'javdb'
  public siteId = 2
  public waterfall: Waterfall
  constructor() {
    super()
    this.waterfall = new Waterfall(this, this.selector)
  }
  private task: Task = new Task(this)
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
    if (!useConfigStore().currentConfig.loadThumbnailSwitch) {
      return
    }
    GM_addStyle(`.movie-list{display: flex;flex-direction: column;} .max{width:100%} .min{width:100%} 
        .movie-list .item .cover { position: relative; padding-top: 15%; background: white;}`)
    console.log(`样式添加成功`)
  }

  private enableWaterfall() {
    const item = $(this.selector.container).find(this.selector.item)
    if (!item.length) {
      return
    }
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
      this.task.addTasks(items)
      return items
    }
    return []
  }

  loadCompleted(): void {
    this.hasLoadCompleted = true
  }

  updateInfo(item: JQuery, info: Info): void {
    const parsedDate = dayjs(info.date)
    if (parsedDate.isValid()) {
      const pathDate = parsedDate.format(FORMAT.PATH_DATE)
      useSisterStore().updateInfo({ serialNumber: info.serialNumber, pathDate })
    }
  }

  async download() {
    const serialNumber = useSisterStore().current_key
    console.log('下载', serialNumber)
    if (!serialNumber) {
      ElNotification({ title: '提示', message: '没有选中', type: 'info' })
      return
    }
    if (await haveArchived(serialNumber)) {
      ElNotification({ title: '提示', message: '已经归档', type: 'info' })
      return
    }

    const detailHref = getDetailHref($('#' + serialNumber))
    if (detailHref === undefined) {
      ElNotification({ title: '提示', message: '没有找到详情页', type: 'info' })
      return
    }
    if (this.downloadList.has(serialNumber)) {
      ElNotification({ title: '提示', message: '正在下载中', type: 'info' })
      return
    }
    this.downloadList.set(serialNumber, 1)
    downloadFromLocal(detailHref)
      .then((r) => {
        if (r) {
          const magnet = r.attr('href')
          if (magnet === undefined) {
            ElNotification({ title: 'javdb', message: '没有找到磁力链接', type: 'error' })
            return
          }
          clickMagnet(magnet)
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

  allRead() {}

  save(serialNumber: string): void {
    const info = useSisterStore().queue.find((item) => item.serialNumber === serialNumber)
    if (!info) {
      return
    }
    console.log(info.pathDate)
    if (info.haveRead) {
      console.log('已经记录', serialNumber)
      return
    }
    const pathDate = info.pathDate
    if (pathDate === undefined || pathDate === '') {
      ElNotification({ title: '提示', message: `${serialNumber}日期格式有变动`, type: 'error' })
      return
    }

    uploadHistory(serialNumber, info).then((history) => {
      console.log('上传成功', history)
      useSisterStore().updateInfo({ serialNumber, haveRead: true, status: 200 })
    })
  }

  showControlPanel(): boolean {
    return $(this.selector.container).length > 0
  }
}
