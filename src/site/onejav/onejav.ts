import type { Selector } from '@/waterfall/index'
import Waterfall from '@/waterfall/index'
import { getId, getJavstoreUrl, getPreviewElement, getPreviewUrlFromJavStore, getSorId } from '@/common'
import { SiteAbstract } from '../site-abstract'
import $ from 'jquery'
import { picx } from '@/dictionary'

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

export class Onejav extends SiteAbstract {
  public name = 'onejav'
  public waterfall: Waterfall
  public sisters: Sisters

  selector: Selector = {
    next: 'a.pagination-next.button.is-primary',
    item: 'div.card.mb-3',
    container: '#waterfall',
    pagination: '.pagination.is-centered'
  } as Selector
  theme = {
    PRIMARY_COLOR: '#00d1b2'
  }
  private task: Task = new Task(this)

  constructor(sisters: Sisters) {
    super()
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
    if (this.checkSite() && elems) {
      for (let index = 0; index < elems.length; index++) {
        this.task.addTask($(elems[index]))
      }
    }
  }

  async addPreview(item: JQuery, type = 0) {
    const detail = item.find('h5.title.is-4.is-spaced a')[0]
    const date = item.find('p.subtitle a').text().trim()
    const pathDate = item.find('p.subtitle a').attr('href')
    const serialNumber = $(detail)
      .text()
      .replace(/ /g, '')
      .replace(/[\r\n]/g, '') //去掉空格//去掉回车换行

    const sortId = getSorId(serialNumber, type)
    // console.log('sortId', sortId);
    // let serialNumber: string = 'test123456'
    const el_link = detail.parentElement

    super.addLink('搜索中', el_link, serialNumber, item)

    if (type > 0) {
      super.addLink('智能搜索中', el_link, serialNumber, item)
    }

    // console.log('添加', originalId, date);

    item.attr('id', serialNumber)
    const loadUrl = picx('/load.svg')
    const failedUrl = picx('/failed.svg')
    let haveRead = false
    const history = historySerialNumbers.get(serialNumber)
    if (history && history.pathDate == pathDate) {
      haveRead = true
    }
    this.sisters.updateInfo({ serialNumber, src: loadUrl, date, haveRead, pathDate, status: 200 })

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

    const javstoreUrl = await getJavstoreUrl(sortId, 3)

    if (javstoreUrl === null) {
      this.sisters.updateInfo({ serialNumber, src: failedUrl, status: 404 })
      preview.children('img').attr('src', failedUrl)
      this.addPreview(item, type + 1).then()
      return
    } else {
      this.addLink('JavStore', el_link, serialNumber, item, javstoreUrl)
    }

    // 番号预览大图
    const imgUrl = await getPreviewUrlFromJavStore(javstoreUrl, serialNumber)

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

  download(): void {
    console.log('下载', this.sisters.current_key)
    const $id = $('#' + this.sisters.current_key)
    const $download = $id.find("a[title='Download .torrent']")
    $download[0].click()
  }

  showControlPanel(): boolean {
    return !!$('body').has(this.selector.item).length
  }

  loadCompleted(): void {
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
      this.waterfall.flow(1)
    } else {
      this.waterfall.flow()
    }
  }
}
