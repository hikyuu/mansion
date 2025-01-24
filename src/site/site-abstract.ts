import type { Selector } from '@/waterfall'
import Waterfall from '../waterfall'
import type { SiteInterface } from './site-interface'
import { type Info, Sister } from './sister'
import type { Theme } from '@/site/index'
import { getDetailFromJavStore } from '@/site/index'
import type { Ref } from 'vue'
import { KEY, picx } from '@/dictionary'
import $ from 'jquery'

import { getJavstoreUrl, getPreviewElement, getSortId } from '@/common'
import { useConfigStore } from '@/store/config-store'
import { getHistories, type HistoryDto, uploadHistory } from '@/dao/browse-history'
import { getPreviewUrlFromDetail, getTitleFromDetail } from '@/site/javstore/javstore-api'
import { ProjectError } from '@/common/errors'

export abstract class SiteAbstract implements SiteInterface {
  hasLoadCompleted = false

  downloadList: Map<string, number> = new Map()

  abstract name: string

  abstract siteId: number

  abstract selector: Selector

  abstract sisters: Sister

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

  abstract allRead(): void

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
      this.addPreview(elem).then()
    })
  }

  scrollToCurrent(x: Ref<number>, y: Ref<number>): void {
    let prev = $('#' + this.sisters.current_key)
    switch (useConfigStore().currentConfig.navigationPoint) {
      case 1:
        prev = prev.find('#preview')
        break
    }
    if (prev.length === 0) return
    const offset = prev.offset()
    if (offset === undefined) return
    y.value = offset.top - 52
  }

  loadNext(): void {
    this.waterfall.appendNext()
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

    const info = this.sisters.updateInfo({
      serialNumber,
      src: loadUrl,
      date,
      repeatSite: 0,
      site: this.siteId,
      status: 200
    })
    this.updateInfo(item, info)
    return info
  }

  /**
   * 添加预览图
   * @param item
   * @param type
   * @param onlyInfo
   */
  async addPreview(item: JQuery, type = 0, onlyInfo = false) {
    const serialNumber = this.sortSerialNumber(item)

    const info = this.buildInfo(item, serialNumber)

    await this.updateRepeat(serialNumber, info)

    const preview = this.handlePreview(serialNumber, item)

    const el_link = this.handleLink(item, serialNumber, type, info)

    const sortId = this.handleSortId(serialNumber, type, el_link, item, preview)

    if (onlyInfo) return

    const javstoreUrl = await this.handleJavstoreUrl(sortId, serialNumber, preview, item, type, el_link)

    const javstoreDetail = await this.handleDetail(javstoreUrl, serialNumber, preview, el_link, item)

    this.resolveTitle(javstoreDetail, serialNumber)
    // 番号预览大图
    await this.updateImgUrl(javstoreDetail, serialNumber, preview, el_link, item, javstoreUrl)
  }

  private handleSortId(serialNumber: string, type: number, el_link: JQuery, item: JQuery, preview: JQuery) {
    const failedUrl = picx('/failed.svg')
    const sortId = getSortId(serialNumber, type)
    console.log('sortId:', sortId)
    if (sortId === undefined) {
      this.addLink('没找到', el_link, serialNumber, item)
      preview.children('img').attr('src', failedUrl)
      this.sisters.updateInfo({ serialNumber, src: failedUrl, status: 500 })
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: 'sortId is undefined'
      })
    }
    return sortId
  }

  private handlePreview(serialNumber: string, item: JQuery) {
    const preview = getPreviewElement(serialNumber, picx('/load.svg'), false)
    item.find('#preview').remove()
    item.append(preview)
    return preview
  }

  private handleLink(item: JQuery, serialNumber: string, type: number, info: Info) {
    const el_link = item.find(this.selector.link).first()

    this.addLink('搜索中', el_link, serialNumber, item)
    if (type > 0) {
      this.addLink('智能搜索中', el_link, serialNumber, item)
    }
    if (useConfigStore().currentConfig.skipRead && info.haveRead) {
      item.remove()
      console.log('删除已读', serialNumber)
      this.sisters.sisterNumber--
      this.sisters.deleteInfo(serialNumber)
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
    preview: JQuery,
    el_link: JQuery,
    item: JQuery
  ) {
    const javstoreDetail = await getDetailFromJavStore(javstoreUrl)
    if (javstoreDetail === undefined) {
      this.sisters.updateInfo({ serialNumber, src: picx('/failed.svg'), status: 404 })
      preview.children('img').attr('src', picx('/failed.svg'))
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
    preview: JQuery,
    item: JQuery,
    type: number,
    el_link: JQuery
  ) {
    const javstoreUrl = await getJavstoreUrl(sortId, 1000)
    if (javstoreUrl === null) {
      this.sisters.updateInfo({ serialNumber, src: picx('/failed.svg'), status: 404 })
      preview.children('img').attr('src', picx('/failed.svg'))
      this.addPreview(item, type + 1).then()
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: 'javstoreUrl is null'
      })
    } else {
      this.addLink('JavStore', el_link, serialNumber, item, javstoreUrl)
      this.sisters.updateInfo({ serialNumber, javStoreUrl: javstoreUrl })
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
      this.sisters.updateInfo({ serialNumber, likeWords, unlikeWords })
    }
  }

  private async updateImgUrl(
    javstoreDetail: Document,
    serialNumber: string,
    preview: JQuery,
    el_link: JQuery,
    item: JQuery,
    javstoreUrl: string
  ) {
    const imgUrl = await getPreviewUrlFromDetail(javstoreDetail, serialNumber)
    if (!imgUrl) {
      this.sisters.updateInfo({ serialNumber, src: picx('/failed.svg'), status: 405 })
      preview.children('img').attr('src', picx('/failed.svg'))
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

  private async updateRepeat(serialNumber: string, info: Info) {
    const histories = await getHistories(serialNumber)
    const haveRead = histories.length > 0
    this.sisters.updateInfo({ serialNumber, haveRead })
    // console.log('添加预览图：通用')
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
