import type { Selector } from '@/waterfall/waterfall'
import Waterfall from '../waterfall/waterfall'
import type { SiteInterface } from './site-interface'
import type { Theme } from '@/site/site'
import { getDetailFromJavStore } from '@/site/site'
import type { Ref } from 'vue'
import { KEY, picx } from '@/dictionary'
import $ from 'jquery'

import { getJavstoreUrl, getThumbnailElement, getSortId, thumbnail_id } from '@/common/common'
import { useConfigStore } from '@/store/config-store'
import { getHistories, type HistoryDto, uploadHistory } from '@/dao/browse-history'
import { getThumbnailUrlFromDetail, getTitleFromDetail } from '@/site/javstore/javstore-api'
import { ProjectError } from '@/common/errors'
import { type Info, useSisterStore } from '@/store/sister-store'

export abstract class SiteAbstract implements SiteInterface {
  hasLoadCompleted = false

  downloadList: Map<string, number> = new Map()

  abstract name: string

  abstract siteId: number

  abstract selector: Selector

  abstract waterfall: Waterfall

  abstract theme: Theme
  // 声明抽象的方法，让子类去实现
  abstract mount(): void

  abstract resolveElements(elems: JQuery): Promise<JQuery[]>

  abstract download(): void

  abstract showControlPanel(): boolean

  abstract save(serialNumber: string): void

  abstract loadCompleted(): void

  abstract checkSite(): boolean

  addLink(
    text: string,
    titleElement: JQuery | null,
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
      titleElement.append(
        `<a id="${javstore_key}" style="color:red;" href="${javstoreUrl}" target="_blank" title="点击到JavStore看看">&nbsp;&nbsp;JavStore</a>`
      )
      return
    }
    titleElement.append(
      `<a id="${javstore_key}" style="color:red;" target="_blank" title="点击重试">&nbsp;&nbsp;${text}</a>`
    )
    const $titleInfo = elem.find(javstore_id_key).first().last()
    $titleInfo.on('click', () => {
      $titleInfo.css('color', 'blue').text(`\u00A0\u00A0${text}重试中`)
      console.log(`重试`)
      this.processThumbnail(elem).then()
    })
  }

  scrollToCurrent(x: Ref<number>, y: Ref<number>): void {
    let prev = $('#' + useSisterStore().current_key)
    switch (useConfigStore().currentConfig.navigationPoint) {
      case 1:
        prev = prev.find(`#${thumbnail_id}`)
        break
    }
    if (prev.length === 0) return
    const offset = prev.offset()
    if (offset === undefined) return
    y.value = offset.top - 52
  }

  async loadNext() {
    await this.waterfall.appendNext()
  }

  protected getCurrentWindowElement(detail: JQuery, scrollTop: number) {
    const detailTop = detail.offset()?.top
    if (detailTop === undefined) return
    const detailHeight = detail.height()
    if (detailHeight === undefined) return
    //当前页面顶部位置大于等于元素的顶部位置并且小于元素的底部位置
    if (scrollTop >= detailTop - 60 && detailTop + detailHeight > scrollTop) {
      const serialNumber = detail.attr('id')
      // console.log(detailTop, scrollTop)
      // console.log('当前窗口元素：', serialNumber)
      if (!serialNumber || useSisterStore().current_key === serialNumber) {
        return
      }
      useSisterStore().setCurrent(serialNumber)
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
  private buildInfo(item: JQuery, serialNumber: any) {
    item.attr('id', serialNumber)
    const sisters = $(this.selector.container).find(`#${serialNumber}`)
    if (sisters.length > 1) {
      sisters.last().remove()
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '发现重复妹妹'
      })
    }

    const loadUrl = picx('/load.svg')
    const date = item.find(this.selector.date).text().trim()

    const info = useSisterStore().updateInfo({
      serialNumber,
      src: [loadUrl],
      date,
      repeatSite: 0,
      site: this.siteId,
      status: 200
    })
    this.updateInfo(item, info)
    return info
  }

  /**
   * 添加缩略图
   * @param item
   * @param type
   * @param onlyInfo
   */
  async processThumbnail(item: JQuery, type = 0, onlyInfo = false): Promise<void> {
    const serialNumber = this.sortSerialNumber(item)

    const info = this.buildInfo(item, serialNumber)

    await this.updateRepeat(serialNumber, info)

    this.DeleteReadedNode(item, info)

    const thumbnail = this.creatThumbnail(serialNumber, item)

    const el_link = this.handleLink(item, serialNumber, type, info)

    const sortId = this.handleSortId(serialNumber, type, el_link, item, thumbnail)

    if (onlyInfo) return

    const javstoreUrl = await this.handleJavstoreUrl(sortId, serialNumber, thumbnail, item, type, el_link)

    if (javstoreUrl === null) return await this.processThumbnail(item, type + 1)

    const javstoreDetail = await this.handleDetail(javstoreUrl, serialNumber, thumbnail, el_link, item)

    this.resolveTitle(javstoreDetail, serialNumber)
    // 番号缩略大图
    await this.updateImgUrl(javstoreDetail, serialNumber, thumbnail, el_link, item, javstoreUrl)
  }

  DeleteReadedNode(item: JQuery, info: Info) {
    if (useConfigStore().currentConfig.skipRead && info.haveRead) {
      item.remove()
      console.log('删除已读', info.serialNumber)
      this.waterfall.setSisterNumber()
      useSisterStore().deleteInfo(info.serialNumber)
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '删除已读'
      })
    }
  }

  async filterReaded(elems: JQuery): Promise<JQuery[]> {
    if (!useConfigStore().currentConfig.skipRead) {
      const items = new Array<JQuery>()
      elems.each((index, elem) => {
        items.push($(elem))
      })
      return items
    }
    const items = new Map<string, JQuery>()
    elems.each((index, elem) => {
      const item = $(elem)
      const serialNumber = this.sortSerialNumber(item)
      items.set(serialNumber, item)
    })
    const keys = Array.from(items.keys())
    const historyDtos = await getHistories(keys)
    historyDtos.forEach((item) => {
      const node = items.get(item.serial_number)
      if (node) {
        node.remove()
        items.delete(item.serial_number)
      }
    })
    return Array.from(items.values())
  }

  private handleSortId(serialNumber: string, type: number, el_link: JQuery, item: JQuery, thumbnail: JQuery) {
    const sortId = getSortId(serialNumber, type)
    console.log('sortId:', sortId)
    if (sortId === undefined) {
      this.addLink('没找到', el_link, serialNumber, item)
      const failedUrl = [picx('/failed.svg')]
      this.updateThumbnail(serialNumber, thumbnail, failedUrl)
      useSisterStore().updateInfo({ serialNumber, src: failedUrl, status: 500 })
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: 'sortId is undefined'
      })
    }
    return sortId
  }

  private creatThumbnail(serialNumber: string, item: JQuery) {
    const thumbnail = getThumbnailElement(serialNumber, [picx('/load.svg')])
    item.find(`#${thumbnail_id}`).remove()
    item.append(thumbnail)
    return thumbnail
  }

  private updateThumbnail(serialNumber: string, thumbnail: JQuery, urls: string[]) {
    const element = getThumbnailElement(serialNumber, urls)
    thumbnail.replaceWith(element)
  }

  private handleLink(item: JQuery, serialNumber: string, type: number, info: Info) {
    const el_link = item.find(this.selector.link).first()

    this.addLink('搜索中', el_link, serialNumber, item)
    if (type > 0) {
      this.addLink('智能搜索中', el_link, serialNumber, item)
    }
    if (useConfigStore().currentConfig.skipRead && info.haveRead) {
      this.addLink('跳过已读', el_link, serialNumber, item)
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '跳过已读'
      })
    }
    return el_link
  }

  private async handleDetail(
    javstoreUrl: string,
    serialNumber: string,
    thumbnail: JQuery,
    el_link: JQuery,
    item: JQuery
  ) {
    const javstoreDetail = await getDetailFromJavStore(javstoreUrl)
    if (javstoreDetail === undefined) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: 404 })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      this.addLink('详情获取失败', el_link, serialNumber, item, javstoreUrl, false)
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: 'javstoreDetail is undefined'
      })
    }
    return javstoreDetail
  }

  private async handleJavstoreUrl(
    sortId: string,
    serialNumber: string,
    thumbnail: JQuery,
    item: JQuery,
    type: number,
    el_link: JQuery
  ) {
    const javstoreUrl = await getJavstoreUrl(sortId, 1000)
    if (javstoreUrl === null) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: 404 })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      return null
    } else {
      this.addLink('JavStore', el_link, serialNumber, item, javstoreUrl)
      useSisterStore().updateInfo({ serialNumber, javStoreUrl: javstoreUrl })
    }
    return javstoreUrl
  }

  private resolveTitle(javstoreDetail: Document, serialNumber: string) {
    const title = getTitleFromDetail(javstoreDetail)
    if (title) {
      if (title === '') return
      const likeWords = useConfigStore().currentConfig.keyword.like.filter((item) => {
        return title.includes(item)
      })
      const unlikeWords = useConfigStore().currentConfig.keyword.unlike.filter((item) => {
        return title.includes(item)
      })
      useSisterStore().updateInfo({ serialNumber, likeWords, unlikeWords })
    }
  }
  async sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  private async updateImgUrl(
    javstoreDetail: Document,
    serialNumber: string,
    thumbnail: JQuery,
    el_link: JQuery,
    item: JQuery,
    javstoreUrl: string
  ) {
    const imgUrl = await getThumbnailUrlFromDetail(javstoreDetail, serialNumber)
    if (imgUrl.length === 0) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: 405 })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      this.addLink('图片获取失败', el_link, serialNumber, item, javstoreUrl, false)
    } else {
      useSisterStore().updateInfo({ serialNumber, src: imgUrl, status: 202 })
      this.updateThumbnail(serialNumber, thumbnail, imgUrl)
    }
  }

  private async updateRepeat(serialNumber: string, info: Info) {
    const histories = await getHistories([serialNumber])
    const haveRead = histories.length > 0
    useSisterStore().updateInfo({ serialNumber, haveRead })
    // console.log('添加缩略图：通用')
    if (haveRead) {
      const repeats = histories.filter((item) => {
        return item.path_date !== info.pathDate || item.site !== info.site
      })
      if (repeats.length > 0) {
        console.log('发现重复已读', repeats)
        useSisterStore().updateInfo({ serialNumber, repeatSite: this.siteId })
        const otherSite = repeats.find((item: HistoryDto) => item.site !== info.site)
        if (otherSite !== undefined) {
          useSisterStore().updateInfo({ serialNumber, repeatSite: otherSite.site })
        }
      }
      if (histories.find((item) => item.path_date === info.pathDate && item.site === info.site) === undefined) {
        uploadHistory(serialNumber, info).then()
      }
    }
  }

  private sortSerialNumber(item: JQuery) {
    return item
      .find(this.selector.serialNumber)
      .first()
      .text()
      .replace(/[-_]/g, '')
      .replace(/[\r\n]/g, '') //去掉空格//去掉回车换行
      .replace(/ /g, '')
  }

  abstract updateInfo(item: JQuery, info: Info): void
}
