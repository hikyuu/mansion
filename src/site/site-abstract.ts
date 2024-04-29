import type { Selector } from '../waterfall'
import Waterfall from '../waterfall'
import type { SiteInterface } from './site-interface'
import { Sisters } from './sisters'
import type { Theme } from '@/site/index'
import type { Ref } from 'vue'
import { KEY, picx } from '@/dictionary/index'
import $ from 'jquery'
import { getJavstoreUrl, getPreviewElement, getPreviewUrlFromJavStore, getSorId } from '@/common/index'
import { historySerialNumbers } from '@/site/onejav/onejav-history'

export abstract class SiteAbstract implements SiteInterface {
  abstract name: string

  abstract selector: Selector

  abstract sisters: Sisters

  abstract waterfall: Waterfall

  abstract theme: Theme

  // 声明抽象的方法，让子类去实现
  abstract mount(): void

  abstract findImages(elems: JQuery): void

  abstract download(): void

  abstract showControlPanel(): boolean

  abstract save(serialNumber: string): void

  abstract loadCompleted(): void

  abstract checkSite(): boolean

  addLink(
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
      this.addPreview(elem)
    })
  }

  scrollToCurrent(x: Ref<number>, y: Ref<number>): void {
    const prev = $('#' + this.sisters.current_key).find('#preview')
    if (prev.length === 0) return
    const offset = prev.offset()
    if (offset === undefined) return
    y.value = offset.top
  }

  loadNext(): void {
    this.waterfall.appendNext()
  }

  protected getCurrentWindowElement(detail: JQuery, scrollTop: number) {
    const detailTop = detail.offset()?.top
    if (detailTop === undefined) return
    const detailHeight = detail.height()
    if (detailHeight === undefined) return
    if (detailTop <= scrollTop && detailTop + detailHeight > scrollTop) {
      const serialNumber = detail.attr('id')
      // console.log('当前窗口元素：', serialNumber)
      if (!serialNumber || this.sisters.current_key === serialNumber) {
        return
      }
      this.sisters.setCurrent(serialNumber)
    }
  }

  onScrollEvent(windowHeight: number, scrollTop: number) {
    // console.log('===触发判断当前窗口元素===');
    const details = $(this.selector.container).find(this.selector.item)
    if (details.length === 0) {
      console.error('滚动事件：没有找到妹妹')
      return
    }
    for (const detail of details) {
      this.getCurrentWindowElement($(detail), scrollTop)
    }
  }

  async addPreview(item: JQuery, type = 0) {
    // console.log('添加预览图：通用')
    const serialNumber = item
      .find(this.selector.serialNumber)
      .first()
      .text()
      .replace(/ /g, '')
      .replace(/[\r\n]/g, '')
    //去掉空格//去掉回车换行
    const date = item.find(this.selector.date).text().trim()
    const pathDate = item.find(this.selector.pathDate).text().trim()
    const sortId = getSorId(serialNumber, type)
    const el_link = item.find('div.tag.is-info')[0]
    this.addLink('搜索中', el_link, serialNumber, item)
    if (type > 0) {
      this.addLink('智能搜索中', el_link, serialNumber, item)
    }
    item.attr('id', serialNumber)
    const loadUrl = picx('/load.svg')
    const failedUrl = picx('/failed.svg')
    const haveRead = historySerialNumbers.has(serialNumber)
    this.sisters.updateInfo({ serialNumber, src: loadUrl, date, haveRead, pathDate, status: 200 })
    const preview = getPreviewElement(serialNumber, loadUrl, false)
    item.find('#preview').remove()
    item.append(preview)
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
}
