import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '@/waterfall/waterfall'
import { getSortId, isFC2 } from '@/common/common'
import { SiteAbstract } from '../site-abstract'
import $ from 'jquery'
import { WaterfallStatus } from '@/dictionary'

import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { Task } from '@/site/task'
import { ElNotification } from 'element-plus'
import { haveArchived, upsertArchive } from '@/dao/archive'
import { highScoreMagnet } from '@/site/javdb/javdb-api'
import { uploadDaily } from '@/dao/onejav-daily-dao'
import { loadDailyHistory, loadLatestHistory, uploadHistory } from '@/dao/browse-history'
import { useSisterStore } from '@/store/sister-store'
import type { Info } from '@/store/sister-store'

export function clickMagnet(magnet: string) {
  const $a = $('<a>', {
    href: magnet,
    style: 'display:none;' // 隐藏 a 标签
  }).appendTo('body')
  $a[0].click()
  ElNotification({ title: 'javdb', message: '已经开始下载', type: 'success' })
}

export async function downloadFromJavDB(serialNumber: string): Promise<boolean> {
  if (isFC2(serialNumber)) {
    return Promise.resolve(false)
  }
  const sortId = getSortId(serialNumber, 1)
  console.log('sortId:', sortId)
  if (sortId === undefined) {
    ElNotification({ title: 'javdb', message: '番号解析失败', type: 'error' })
    return Promise.resolve(false)
  }
  return highScoreMagnet(sortId)
    .then((r) => {
      if (r) {
        const magnet = r.attr('href')
        if (magnet === undefined) {
          ElNotification({ title: 'javdb', message: '没有找到磁力链接', type: 'error' })
          return false
        }
        clickMagnet(magnet)
        return true
      }
      return false
    })
    .catch((e) => {
      ElNotification.error({ title: 'javdb', message: e })
      return false
    })
}

export class Onejav extends SiteAbstract {
  public name = 'onejav'
  public siteId = 1
  public waterfall: Waterfall
  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered',
    serialNumber: 'h5.title.is-4.is-spaced a',
    link: 'h5.title.is-4.is-spaced',
    date: 'p.subtitle a'
  } as Selector
  theme = {
    PRIMARY_COLOR: '#00d1b2',
    SECONDARY_COLOR: '#e3f5f3',
    WARNING_COLOR: '#fadd65'
  }
  private task: Task = new Task(this)

  constructor() {
    super()
    this.waterfall = new Waterfall(this, this.selector)
  }
  async mount(): Promise<void> {
    // this.adObserve()
    this.addStyle()

    this.homeVisible()

    const $onejav = this.homeContainer()
    // 瀑布流脚本
    this.enableWaterfall($onejav)
  }

  async resolveElements(elems: JQuery): Promise<JQuery[]> {
    if (this.checkSite() && elems) {
      const items = await this.filterReaded(elems)
      this.task.addTasks(items)
      return items
    }
    return []
  }

  updateInfo(item: JQuery, info: Info): void {
    const pathDate = item.find('p.subtitle a').attr('href')
    this.sister.updateInfo({ serialNumber: info.serialNumber, pathDate })
  }

  // save(serialNumber: string): void {
  //   const info = this.sister.getInfo(serialNumber)
  //   if (!info) {
  //     return
  //   }
  //   const pathDate = info.pathDate
  //   if (pathDate === undefined || pathDate === '') {
  //     ElNotification({ title: '提示', message: `${serialNumber}日期格式有变动`, type: 'error' })
  //     return
  //   }
  //   if (info.haveRead) {
  //     console.log('已经记录', serialNumber)
  //     return
  //   }
  //   uploadHistory(serialNumber, info).then(() => {
  //     this.sister.updateInfo({ serialNumber, haveRead: true, status: 200 })
  //   })
  // }

  checkSite(): boolean {
    return /(onejav)/g.test(document.URL)
  }

  async download(checkArchive: boolean) {
    const currentKey = this.sister.current_key
    console.log('下载', currentKey)
    if (currentKey === undefined) {
      ElNotification({ title: '提示', message: '没有选中', type: 'info' })
      return
    }
    if (checkArchive && (await haveArchived(currentKey))) {
      ElNotification({ title: '提示', message: '已经归档', type: 'info' })
      return
    }
    const $id = $('#' + currentKey)
    const $download = $id.find("a[title='Download .torrent']")
    const info = this.sister.currentSister
    if (!info) return
    const serialNumber = info.serialNumber
    if (this.downloadList.has(serialNumber)) {
      ElNotification({ title: '提示', message: '正在下载中', type: 'info' })
      return
    }
    this.downloadList.set(serialNumber, 10)
    downloadFromJavDB(serialNumber)
      .then((success) => {
        if (success) return
        if ($download.length === 0) {
          ElNotification({ title: '下载地址', message: '没有找到下载地址', type: 'error' })
          return
        }
        $download[0].click()
        ElNotification({ title: 'onejav', message: '已经开始下载', type: 'success' })
      })
      .finally(() => {
        upsertArchive(serialNumber)
        this.downloadList.delete(serialNumber)
        this.closeDetailPage()
      })
  }

  closeDetailPage() {
    if (location.pathname.includes('torrent')) {
      window.close()
    }
  }

  showControlPanel(): boolean {
    return !!$('body').has(this.selector.item).length
  }

  allLoadCompleted(): void {
    this.hasLoadCompleted = true
    uploadDaily(location.pathname, this.sister.sisterNumber, true).then()
  }

  private addStyle() {
    GM_addStyle(`.max{width:100%} .min{width:100%} `)
  }

  private homeContainer() {
    // 插入自己创建的div
    $('div.container nav.pagination.is-centered').before("<div id='card' ></div>")
    // 将所有番号内容移到新建的div里
    const $onejav = $('div.container div.card.mb-3')
    $('div#card').append($onejav)
    return $onejav
  }

  private homeVisible() {
    console.log(`监听页面切换状态`, document.visibilityState)
    $(document).on('visibilitychange', () => {
      if (document.visibilityState == 'visible') {
        loadLatestHistory().then((histories) => {
          const pathDateSet = new Set<string>()
          histories.forEach((history) => {
            pathDateSet.add(history.path_date)
            const info = this.sister.getInfo(history.serial_number)
            if (info === undefined) return
            if (info.haveRead) return
            this.sister.updateInfo({ serialNumber: history.serial_number, haveRead: true })
            if (info.pathDate !== history.path_date || info.site !== history.site) {
              this.sister.updateInfo({ serialNumber: history.serial_number, repeatSite: history.site })
              uploadHistory(info.serialNumber, info).then()
            }
          })
          loadDailyHistory(pathDateSet, this.siteId).then()
        })
      }
    })
  }

  private adObserve() {
    $('body')
      .children('div')
      .each((index, element) => {
        if ($(element).css('position') === 'fixed' && $(element).css('inset') === '0px') {
          console.log('发现广告!!!', element)
          $(element).off('click')
          console.log('屏蔽广告!!!')
        }
      })
    const overview = document.querySelector('body')
    if (overview === null) return
    //获取网页地址中的路径'
    const mutationObserver = new MutationObserver((mutationsList) => {
      for (const mutationRecord of mutationsList) {
        mutationRecord.addedNodes.forEach((element, number, parentNode) => {
          if (element.nodeName !== 'DIV') return
          if ($(element).css('position') === 'fixed' && $(element).css('inset') === '0px') {
            console.log('监听到广告!!!', element)
            $(element).off('click')
            console.log('屏蔽广告!!!')
          }
        })
      }
    })
    mutationObserver.observe(overview, {
      attributes: false, // 属性的变动。
      characterData: true, //节点内容或节点文本的变动。
      childList: true, //子节点的变动（指新增，删除或者更改）。
      subtree: false, //布尔值，表示是否将该观察器应用于该节点的所有后代节点。
      attributeOldValue: false, //布尔值，表示观察attributes变动时，是否需要记录变动前的属性值。
      characterDataOldValue: false //布尔值，表示观察characterData变动时，是否需要记录变动前的值。
      //attributeFilter：数组，表示需要观察的特定属性（比如[‘class’,‘src’]）。
    })
  }

  private enableWaterfall($onejav: JQuery) {
    if (!$onejav.length) {
      return
    }
    if ($onejav[0].parentElement === null) {
      console.log('当前页面有变动,通知开发者')
      return
    }
    $onejav[0].parentElement.id = 'waterfall'
    if (isNaN(Date.parse(location.pathname))) {
      ElNotification({ title: '瀑布流', message: `页数可能较多强制启用懒加载模式`, type: 'info' })
      this.waterfall.flow(WaterfallStatus.lazy.code).then()
    } else {
      this.waterfall.flow().then()
    }
  }

  allRead() {
    if (!this.waterfall.page.isEnd) {
      ElNotification({ title: '提示', message: '请等待加载完成', type: 'warning' })
      return
    }
    this.task.runAll()
  }
}
