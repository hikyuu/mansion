import type { Selector } from '@/waterfall'
import Waterfall from '@/waterfall/index'
import { getJavstoreUrl, getPreviewElement, getSortId, isFC2 } from '@/common'
import { SiteAbstract } from '../site-abstract'
import $ from 'jquery'
import { picx, WaterfallStatus } from '@/dictionary'

import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { Sister } from '@/site/sister'
import { Task } from '@/site/task'
import { ElNotification } from 'element-plus'
import { haveArchived, upsertArchive } from '@/dao/archive'
import { highScoreMagnet } from '@/site/javdb/javdb-api'
import { useConfigStore } from '@/store/config-store'
import { getDetailFromJavStore } from '@/site'
import { getPreviewUrlFromDetail, getTitleFromDetail } from '@/site/javstore/javstore-api'
import { uploadDaily } from '@/dao/onejav-daily-dao'
import { getHistories, type HistoryDto, loadDailyHistory, loadLatestHistory, uploadHistory } from '@/dao/browse-history'

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
  public sisters: Sister

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered'
  } as Selector
  theme = {
    PRIMARY_COLOR: '#00d1b2',
    SECONDARY_COLOR: '#e3f5f3',
    WARNING_COLOR: '#fadd65'
  }
  private task: Task = new Task(this)

  constructor(sisters: Sister) {
    super()
    this.sisters = sisters
    this.waterfall = new Waterfall(this, this.selector, sisters)
  }
  async mount(): Promise<void> {
    // this.adObserve()
    this.addStyle()

    this.homeVisible()

    const $onejav = this.homeContainer()
    // 瀑布流脚本
    this.enableWaterfall($onejav)
  }

  findImages(elems: JQuery) {
    if (this.checkSite() && elems) {
      for (let index = 0; index < elems.length; index++) {
        this.task.addTask($(elems[index]))
      }
    }
  }

  async addPreview(item: JQuery, type = 0, onlyInfo = false) {
    const detail = item.find('h5.title.is-4.is-spaced a')[0]
    const date = item.find('p.subtitle a').text().trim()
    const pathDate = item.find('p.subtitle a').attr('href')
    const serialNumber = $(detail)
      .text()
      .replace(/[-_]/g, '')
      .replace(/[\r\n]/g, '') //去掉空格//去掉回车换行
      .replace(/ /g, '')

    item.attr('id', serialNumber)
    const sisters = $(this.selector.container).find(`#${serialNumber}`)
    if (sisters.length > 1) {
      console.log('发现重复妹妹', sisters)
      sisters.last().remove()
      return
    }

    const sortId = getSortId(serialNumber, type)
    console.log('sortId:', sortId)
    if (sortId === undefined) return
    // let serialNumber: string = 'test123456'
    const el_link = detail.parentElement

    super.addLink('搜索中', el_link, serialNumber, item)

    if (type > 0) {
      super.addLink('智能搜索中', el_link, serialNumber, item)
    }

    const loadUrl = picx('/load.svg')
    const failedUrl = picx('/failed.svg')

    const info = this.sisters.updateInfo({
      serialNumber,
      src: loadUrl,
      date,
      repeatSite: 0,
      pathDate,
      site: this.siteId,
      status: 200
    })

    const histories = await getHistories(serialNumber)
    const haveRead = histories.length > 0
    this.sisters.updateInfo({ serialNumber, haveRead })
    if (haveRead) {
      const repeats = histories.filter((item) => {
        return item.path_date !== info.pathDate || item.site !== info.site
      })
      if (repeats.length > 0) {
        console.log('发现重复已读', repeats)
        this.sisters.updateInfo({ serialNumber, repeatSite: this.siteId })
        const otherSite = repeats.find((item: HistoryDto) => item.site !== info.site)
        if (otherSite !== undefined) {
          this.sisters.updateInfo({ serialNumber, repeatSite: otherSite.site })
        }
      }
      if (histories.find((item) => item.path_date === info.pathDate && item.site === info.site) === undefined) {
        uploadHistory(serialNumber, info).then()
      }
    }

    if (useConfigStore().currentConfig.skipRead && haveRead) {
      super.addLink('跳过已读', el_link, serialNumber, item)
      return
    }

    const preview = getPreviewElement(serialNumber, loadUrl, false)
    const divEle = item.find('div.container')[0]

    item.find('#preview').remove()
    $(divEle).append(preview)

    if (sortId === undefined) {
      this.addLink('没找到', el_link, serialNumber, item)
      this.sisters.updateInfo({ serialNumber, src: failedUrl, status: 500 })
      preview.children('img').attr('src', failedUrl)
      return
    }

    if (onlyInfo) return

    const javstoreUrl = await getJavstoreUrl(sortId, 3)

    if (javstoreUrl === null) {
      this.sisters.updateInfo({ serialNumber, src: failedUrl, status: 404 })
      preview.children('img').attr('src', failedUrl)
      this.addPreview(item, type + 1).then()
      return
    } else {
      this.addLink('JavStore', el_link, serialNumber, item, javstoreUrl)
      this.sisters.updateInfo({ serialNumber, javStoreUrl: javstoreUrl })
    }

    const javstoreDetail = await getDetailFromJavStore(javstoreUrl)
    if (javstoreDetail === undefined) {
      this.sisters.updateInfo({ serialNumber, src: failedUrl, status: 404 })
      preview.children('img').attr('src', failedUrl)
      this.addLink('详情获取失败', el_link, serialNumber, item, javstoreUrl, false)
      return
    }

    const title = getTitleFromDetail(javstoreDetail)
    console.log(serialNumber, '标题', title)
    if (title) {
      this.resolveTitle(serialNumber, title)
    }

    // 番号预览大图
    const imgUrl = await getPreviewUrlFromDetail(javstoreDetail, serialNumber)

    if (!imgUrl) {
      this.sisters.updateInfo({ serialNumber, src: failedUrl, status: 405 })
      preview.children('img').attr('src', failedUrl)
      this.addLink('图片获取失败', el_link, serialNumber, item, javstoreUrl, false)
    } else {
      this.sisters.updateInfo({ serialNumber, src: imgUrl, status: 202 })
      preview
        .children('img')
        .on('load', () => {
          this.sisters.updateInfo({ serialNumber, status: 200 })
        })
        .on('error', () => {
          const retryString = $(this).attr('retry')
          if (retryString === undefined) return
          let retry = Number(retryString)
          if (retry > 3) {
            $(this).attr('src', picx('/failed.svg')) //设置碎图
            // $(this).css('width', 200).css('height', 200);
            this.sisters.updateInfo({ serialNumber, status: 501 })
          } else {
            console.log('图片加载失败,重试中...')
            $(this).attr('retry', retry++) //重试次数+1
            $(this).attr('src', imgUrl) //继续刷新图片
          }
        })
        .attr('src', imgUrl)
    }
  }

  private resolveTitle(serialNumber: string, title: string) {
    if (title === '') return
    const likeWords = useConfigStore().currentConfig.keyword.like.filter((item) => {
      return title.includes(item)
    })
    const unlikeWords = useConfigStore().currentConfig.keyword.unlike.filter((item) => {
      return title.includes(item)
    })
    this.sisters.updateInfo({ serialNumber, likeWords, unlikeWords })
  }

  save(serialNumber: string): void {
    const info = this.sisters.queue.find((item) => item.serialNumber === serialNumber)
    if (!info) {
      return
    }

    const pathDate = info.pathDate
    if (pathDate === undefined || pathDate === '') {
      ElNotification({ title: '提示', message: `${serialNumber}日期格式有变动`, type: 'error' })
      return
    }
    if (info.haveRead) {
      console.log('已经记录', serialNumber)
      return
    }
    uploadHistory(serialNumber, info).then(() => {
      this.sisters.updateInfo({ serialNumber, haveRead: true, status: 200 })
    })
  }

  checkSite(): boolean {
    return /(onejav)/g.test(document.URL)
  }

  async download() {
    console.log('下载', this.sisters.current_key)
    if (this.sisters.current_key === undefined) {
      ElNotification({ title: '提示', message: '没有选中', type: 'info' })
      return
    }
    if (await haveArchived(this.sisters.current_key)) {
      ElNotification({ title: '提示', message: '已经归档', type: 'info' })
      return
    }
    const $id = $('#' + this.sisters.current_key)
    const $download = $id.find("a[title='Download .torrent']")
    if (this.sisters.current_index === undefined) return
    const serialNumber = this.sisters.queue[this.sisters.current_index].serialNumber
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
        upsertArchive({ serial_number: serialNumber, download_time: new Date() })
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

  loadCompleted(): void {
    this.hasLoadCompleted = true
    uploadDaily(location.pathname, this.sisters.sisterNumber, true).then()
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
            const info = this.sisters.queue.find((item) => item.serialNumber === history.serial_number)
            if (info === undefined) return
            if (info.haveRead) return
            this.sisters.updateInfo({ serialNumber: history.serial_number, haveRead: true })
            if (info.pathDate !== history.path_date || info.site !== history.site) {
              this.sisters.updateInfo({ serialNumber: history.serial_number, repeatSite: history.site })
              uploadHistory(info.serialNumber, info).then()
            }
          })
          loadDailyHistory(pathDateSet).then()
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
      this.waterfall.flow(WaterfallStatus.lazy.code)
    } else {
      this.waterfall.flow()
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
