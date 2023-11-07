import type { Selector } from '@/waterfall/index'
import Waterfall from '@/waterfall/index'
import { getId, getJavstoreUrl, getPreviewElement, getPreviewUrlFromJavStore } from '@/common'
import { SiteAbstract } from '../site-abstract'
import $ from 'jquery'
import { KEY, picx } from '@/dictionary'
import { GM_addStyle } from 'vite-plugin-monkey/dist/client'
import { Sisters } from '@/site/sisters'
import { Task } from '@/site/task'
import {
  getTodayHistories,
  historySerialNumbers,
  loadLocalHistory,
  loadRemoteHistory,
  uploadHistory
} from './onejav-history'
import { loginApiKey } from '../realm'
import { loadDailies, loadLocalDailies, uploadDaily } from './onejav-daily'
import { ElNotification } from 'element-plus'
import type { Ref } from 'vue'

export class Onejav implements SiteAbstract {
  public waterfall: Waterfall
  public sisters: Sisters
  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.container div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered'
  }
  theme = {
    PRIMARY_COLOR: '#00d1b2'
  }
  private task: Task = new Task(this)

  constructor(sisters: Sisters) {
    this.sisters = sisters
    this.waterfall = new Waterfall(this, this.selector, sisters)
  }

  async mount(): Promise<void> {
    this.addStyle()

    loadLocalHistory()
    loadLocalDailies()
    loginApiKey().then(() => {
      loadRemoteHistory().then()
      loadDailies().then()
    })

    this.home()

    this.homeLoadObserve()

    this.homeVisible()

    const $onejav = this.homeContainer()
    // 瀑布流脚本
    this.enableWaterfall($onejav)
  }

  findImages(elems: JQuery) {
    if (document.title.search(/OneJAV/) > 0 && elems) {
      for (let index = 0; index < elems.length; index++) {
        this.task.addTask($(elems[index]))
      }
    }
  }

  async addPreview($elem: JQuery, type = 0) {
    const detail = $elem.find('h5.title.is-4.is-spaced a')[0]
    const date = $elem.find('p.subtitle a').text().trim()
    const pathDate = $elem.find('p.subtitle a').attr('href')
    const serialNumber = $(detail)
      .text()
      .replace(/ /g, '')
      .replace(/[\r\n]/g, '') //去掉空格//去掉回车换行

    const sortId = this.getSorId(serialNumber, type)
    // console.log('sortId', sortId);
    // let serialNumber: string = 'test123456'
    const titleElement = detail.parentElement

    this.addLink('搜索中', titleElement, serialNumber, $elem)

    if (type > 0) {
      this.addLink('智能搜索中', titleElement, serialNumber, $elem)
    }

    // console.log('添加', originalId, date);

    $elem.attr('id', serialNumber)
    const loadUrl = picx('/load.svg')
    const failedUrl = picx('/failed.svg')
    const haveRead = historySerialNumbers.has(serialNumber)
    this.sisters.updateInfo({ serialNumber, src: loadUrl, date, haveRead, pathDate })

    const preview = getPreviewElement(serialNumber, loadUrl, false)
    const divEle = $elem.find('div.container')[0]
    if (divEle) {
      $(divEle).find('#preview').remove()
      $(divEle).append(preview)
    }

    if (sortId === undefined) {
      this.addLink('没找到', titleElement, serialNumber, $elem)
      this.sisters.updateInfo({ serialNumber, src: failedUrl })
      preview.children('img').attr('src', failedUrl)
      return
    }

    const javstoreUrl = await getJavstoreUrl(sortId, 3)

    if (javstoreUrl === null) {
      this.sisters.updateInfo({ serialNumber, src: failedUrl })
      preview.children('img').attr('src', failedUrl)
      this.addPreview($elem, type + 1).then()
      return
    } else {
      this.addLink('JavStore', titleElement, serialNumber, $elem, javstoreUrl)
    }

    // 番号预览大图
    const imgUrl = await getPreviewUrlFromJavStore(javstoreUrl, serialNumber)

    if (!imgUrl) {
      this.sisters.updateInfo({ serialNumber, src: failedUrl })
      preview.children('img').attr('src', failedUrl)

      this.addLink('图片获取失败', titleElement, serialNumber, $elem, javstoreUrl, false)
    } else {
      this.sisters.updateInfo({ serialNumber, src: imgUrl })
      preview.children('img').attr('src', imgUrl)
    }
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
      this.sisters.updateInfo({ serialNumber, haveRead: true })
    })
  }

  onScrollEvent(windowHeight: number, scrollTop: number) {
    // console.log('===触发判断当前窗口元素===');
    const details = $(document).find(this.selector.item)
    for (const detail of details) {
      this.determineTheCurrentElement($(detail), scrollTop)
    }
  }

  download(): void {
    console.log('下载', this.sisters.current_key)
    const $id = $('#' + this.sisters.current_key)
    const $download = $id.find("a[title='Download .torrent']")
    $download[0].click()
  }

  nextStep(x: Ref<number>, y: Ref<number>): void {
    const nextPreview = $('#' + this.sisters.current_key).find('#preview')
    if (nextPreview.length === 0) return
    const offset = nextPreview.offset()
    if (offset === undefined) return
    y.value = offset.top
  }

  previous(x: Ref<number>, y: Ref<number>): void {
    const prev = $('#' + this.sisters.current_key).find('#preview')
    if (prev.length === 0) return
    const offset = prev.offset()
    if (offset === undefined) return
    y.value = offset.top
  }

  showControlPanel(): boolean {
    return !!$('body').has(this.selector.item).length
  }

  loadNext(): void {
    this.waterfall.appendNext()
  }

  loadCompleted(): void {
    uploadDaily(location.pathname, this.sisters.sisterNumber, true).then()
  }

  private addStyle() {
    GM_addStyle(`.max{width:100%} .min{width:100%} `)
    console.log(`样式添加成功`)
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
        loadLocalHistory()
        console.log(`重新加载首页数据`)
        const windowHeight = $(window).height()
        if (windowHeight === undefined) {
          console.log('获取不到窗口高度')
          return false
        }

        const scrollTop = $(window).scrollTop()
        if (scrollTop === undefined) {
          console.log('获取不到滚动高度')
          return false
        }

        for (const card of $('#overview_list div.card.mb-1.card-overview')) {
          const cardTop = $(card).offset()!.top
          const cardHeight = $(card)!.height()
          if (cardHeight === undefined) return

          if (cardTop >= scrollTop - cardHeight && cardTop <= scrollTop + windowHeight) {
            this.loadHistory($(card))
          }
        }
      }
    })
  }

  private homeLoadObserve() {
    const overview = $('#overview_list')[0]
    if (overview === undefined) {
      return
    }
    //获取网页地址中的路径'
    const mutationObserver = new MutationObserver((mutationsList) => {
      for (const mutationRecord of mutationsList) {
        mutationRecord.addedNodes.forEach((node, number, parentNode) => {
          if (node.nodeType !== 1) return
          this.loadHistory($(node))
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

  private home() {
    console.log(`===装修首页===`)
    for (const card of $('#overview_list div.card.mb-1.card-overview')) {
      this.loadHistory($(card))
    }
    this.markAsRead($('div.column .card'))
  }

  private loadHistory(card: JQuery<Node>) {
    card.find('div.thumbnail-text').css('display', 'unset')
    const title = card.find('header.card-header a.card-header-title').first()
    const pathDate = title.attr('href')

    let id = title.attr('id')
    if (id === undefined) {
      id = getId()
      title.attr('id', id)
    }

    if (pathDate !== undefined) {
      const thatDay_histories = getTodayHistories(pathDate)
      if (thatDay_histories.length > 0) {
        title.children(`#${id}`).remove()
        title.append(`<div id="${id}" style="white-space:pre">  ${thatDay_histories.length}部已阅</div>`)
        this.markAsRead(card)
      } else {
        title.children(`#${id}`).remove()
        title.append(`<div id="${id}" style="white-space:pre;color: red">  新！！！</div>`)
      }
    }
  }

  private markAsRead(card: JQuery<Node>) {
    for (const content of card.find('div.card-content a.thumbnail-link')) {
      const contentLink = $(content).attr('href')
      if (contentLink !== undefined) {
        if (historySerialNumbers.has(contentLink)) {
          $(content).find('div.thumbnail-text').html('<span style="white-space:pre">阅</span>')
        }
      }
    }
  }

  private getSorId(originalId: string, type: number): string | undefined {
    switch (type) {
      case 0: {
        const cuttingNumber = originalId.matchAll(/(heyzo|FC2PPV)(\d+)/gi)
        const numberArray = Array.from(cuttingNumber)

        // console.log('numberArray', numberArray);
        if (numberArray.length > 0) {
          if (originalId.matchAll(/(FC2PPV)(\d+)/gi)) {
            return 'FC2-PPV-' + numberArray[0][2]
          }
          return numberArray[0][1] + '-' + numberArray[0][2]
        }
        return originalId
      }
      case 1: {
        const cuttingNumber = originalId.matchAll(/(^[a-z].*[a-z])(\d+)/gi)
        const numberArray = Array.from(cuttingNumber)

        if (numberArray.length === 0) return originalId
        return numberArray[0][1] + '-' + Number(numberArray[0][2])
      }
      case 2: {
        // 123ssis123
        const cuttingNumber = originalId.matchAll(/(^\d+)([a-z].*[a-z])(\d+)/gi)
        const numberArray = Array.from(cuttingNumber)

        if (numberArray.length === 0) return originalId

        return numberArray[0][2] + '-' + Number(numberArray[0][3])
      }
      default:
        return undefined
    }
  }

  private addLink(
    text: string,
    titleElement: HTMLElement | null,
    serialNumber: string,
    elem: JQuery,
    javstoreUrl: null | string = null,
    cover: boolean = true
  ) {
    const javstore_key = `${KEY.JAVSTORE_KEY}${serialNumber}`
    const javstore_id_key = `#${javstore_key}`
    elem.find(javstore_id_key).remove()

    if (titleElement === null) {
      return
    }
    if (javstoreUrl) {
      $(titleElement).append(
        `<a id="${javstore_key}" style="color:red;" href="${javstoreUrl}" target="_blank" title="点击到JavStore看看">&nbsp;&nbsp;JavStore</a>`
      )
      return
    }
    const $title = $(titleElement)
    $title.append(`<a id="${javstore_key}" style="color:red;" target="_blank" title="点击重试">&nbsp;&nbsp;${text}</a>`)
    const $titleInfo = elem.find(javstore_id_key).first().last()
    $titleInfo.on('click', () => {
      $titleInfo.css('color', 'blue').text(`\u00A0\u00A0${text}重试中`)
      console.log(`重试`)
      this.addPreview(elem).then()
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
      this.waterfall.flowLazy()
    } else {
      this.waterfall.flow()
    }
  }

  private determineTheCurrentElement(detail: JQuery, scrollTop: number) {
    const detailTop = detail.offset()?.top
    if (detailTop === undefined) return
    const detailHeight = detail.height()
    if (detailHeight === undefined) return

    if (detailTop <= scrollTop && detailTop + detailHeight > scrollTop) {
      const serialNumber = detail.attr('id')
      if (!serialNumber || this.sisters.current_key === serialNumber) {
        return
      }
      this.sisters.setCurrent(serialNumber)
    }
  }
}
