import jquery from 'jquery'
import { KEY, picx } from '@/dictionary'
import { ProjectError } from '@/common/errors'
import { getThumbnailElement, THUMBNAIL_ID } from '@/common/common'
import { parseSerialNumber } from '@/common/serial-number'
import { parseSister } from '@/site/sister-entry'
import { markReadIfReady } from '@/site/read-marking'
import { getHistories, uploadHistory } from '@/dao/browse-history'
import { getDetailFromJavStore } from '@/site/javstore/javstore-api'
import { getJavstoreUrl, getThumbnailUrlFromDetail, getTitleFromDetail } from '@/site/javstore/javstore-api'
import type { Selector } from '@/waterfall/waterfall'
import { SiteId } from '@/site/site-id'
import { type Info, SisterStatus, useSisterStore } from '@/store/sister-store'
import { useConfigStore } from '@/store/config-store'

/**
 * 缩略图链路对站点的要求：只剩两个可选钩子是站点特有的，
 * 其余（搜索、详情、大图、判档、失败样式、记账）完全一致。
 */
export interface ThumbnailSite {
  readonly siteId: SiteId
  readonly selector: Selector
  /**
   * javstore 详情地址解析。
   * 缺省走「按 sortId 搜索」；javstore 自己直接取条目链接，因此覆盖它。
   * 返回 null 表示该 type 没搜到（调用方会换 type 重试）。
   */
  lookupJavstore?(item: JQuery, serialNumber: string, sortId: string, type: number): Promise<string | null>
  /** 详情页到手后的站点钩子（javstore 用它从详情页补发布日期） */
  onDetail?(detail: Document, serialNumber: string): void
}

/**
 * 妹妹的缩略图链路：判档 → 建缩略图 → 搜索 javstore → 拉详情 → 补标题 → 换大图。
 * 站点差异全部收在 ThumbnailSite 的钩子里，链路本身只写一遍。
 */
export class ThumbnailPipeline {
  constructor(private readonly site: ThumbnailSite) {}

  async processThumbnail(serialNumber: string, item: JQuery, type = 0, onlyInfo = false): Promise<void> {
    const info = this.buildInfo(item, serialNumber)

    await this.updateRepeat(serialNumber, info)

    const thumbnail = this.creatThumbnail(serialNumber, item)
    const elLink = this.handleLink(item, serialNumber, type, info)
    const sortId = this.handleSortId(serialNumber, type, elLink, item, thumbnail)

    if (onlyInfo) return

    const javstoreUrl = await this.handleJavstoreUrl(sortId, serialNumber, thumbnail, item, type, elLink)
    if (javstoreUrl === null) {
      // 站点自带解析（javstore）没有更多变体可试，404 即终态；
      // 通用路径靠 type 变体重试，最终由 getSortId 抛出 500。
      if (this.site.lookupJavstore) {
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: `找不到 JavStore 详情页: ${serialNumber}`
        })
      }
      return await this.processThumbnail(serialNumber, item, type + 1)
    }

    const detail = await this.handleDetail(javstoreUrl, serialNumber, thumbnail, elLink, item)

    this.site.onDetail?.(detail, serialNumber)
    this.resolveTitle(detail, serialNumber)
    // 番号缩略大图
    await this.updateImgUrl(detail, serialNumber, thumbnail, elLink, item, javstoreUrl)
  }

  private buildInfo(item: JQuery, serialNumber: string): Info {
    item.attr('id', serialNumber)
    const sisters = jquery(this.site.selector.container).find(`#${serialNumber}`)
    if (sisters.length > 1) {
      sisters.last().remove()
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '发现重复妹妹'
      })
    }

    const loadUrl = picx('/load.svg')
    // 日期与路径日期由「妹妹条目」统一读，站点不再各自往 Info 上补字段
    const entry = parseSister(item, this.site.selector)
    return useSisterStore().updateInfo({
      serialNumber,
      src: [loadUrl],
      date: entry?.date ?? '',
      pathDate: entry?.pathDate,
      repeatSite: SiteId.UNKNOWN,
      site: this.site.siteId,
      status: SisterStatus.Created
    })
  }

  private addLink(
    text: string,
    titleElement: JQuery | null,
    serialNumber: string,
    elem: JQuery,
    javstoreUrl: null | string = null
  ) {
    const javstoreKey = `${KEY.JAVSTORE_KEY}${serialNumber}`
    const javstoreIdKey = `#${javstoreKey}`
    elem.find(javstoreIdKey).remove()

    if (titleElement === null) {
      return
    }
    if (javstoreUrl) {
      titleElement.append(
        `<a id="${javstoreKey}" style="color:red;" href="${javstoreUrl}" target="_blank" title="点击到JavStore看看">&nbsp;&nbsp;JavStore</a>`
      )
      return
    }
    titleElement.append(
      `<a id="${javstoreKey}" style="color:red;" target="_blank" title="点击重试">&nbsp;&nbsp;${text}</a>`
    )
    const $titleInfo = elem.find(javstoreIdKey).first().last()
    $titleInfo.on('click', () => {
      $titleInfo.css('color', 'blue').text(`\u00A0\u00A0${text}重试中`)
      console.log(`重试`)
      const entry = parseSister(elem, this.site.selector)
      if (!entry) return
      this.processThumbnail(entry.serialNumber, elem).then()
    })
  }

  private handleSortId(serialNumber: string, type: number, elLink: JQuery, item: JQuery, thumbnail: JQuery) {
    try {
      return parseSerialNumber(serialNumber).searchVariant(type)
    } catch (error) {
      this.addLink('没找到', elLink, serialNumber, item)
      const failedUrl = [picx('/failed.svg')]
      this.updateThumbnail(serialNumber, thumbnail, failedUrl)
      useSisterStore().updateInfo({ serialNumber, src: failedUrl, status: SisterStatus.SerialUnparsable })
      if (error instanceof ProjectError) {
        throw error
      }
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: 'getSortId 出错',
        cause: error
      })
    }
  }

  private creatThumbnail(serialNumber: string, item: JQuery) {
    const thumbnail = getThumbnailElement(serialNumber, [picx('/load.svg')])
    item.find(`#${THUMBNAIL_ID}`).remove()
    item.append(thumbnail)
    return thumbnail
  }

  private updateThumbnail(serialNumber: string, thumbnail: JQuery, urls: string[]) {
    const element = getThumbnailElement(serialNumber, urls)
    thumbnail.replaceWith(element)
  }

  private handleLink(item: JQuery, serialNumber: string, type: number, info: Info) {
    const elLink = item.find(this.site.selector.link).first()

    this.addLink('搜索中', elLink, serialNumber, item)
    if (type > 0) {
      this.addLink('智能搜索中', elLink, serialNumber, item)
    }
    if (useConfigStore().getSiteConfig.skipRead && info.haveRead) {
      this.addLink('跳过已读', elLink, serialNumber, item)
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '跳过已读'
      })
    }
    return elLink
  }

  private async handleDetail(
    javstoreUrl: string,
    serialNumber: string,
    thumbnail: JQuery,
    elLink: JQuery,
    item: JQuery
  ) {
    const javstoreDetail = await getDetailFromJavStore(javstoreUrl)
    if (javstoreDetail === undefined) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: SisterStatus.NotFound })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      this.addLink('详情获取失败', elLink, serialNumber, item, javstoreUrl)
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
    elLink: JQuery
  ): Promise<string | null> {
    const lookup = this.site.lookupJavstore
    const javstoreUrl = lookup
      ? await lookup.call(this.site, item, serialNumber, sortId, type)
      : await getJavstoreUrl(sortId, 1000)
    if (javstoreUrl === null) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: SisterStatus.NotFound })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      return null
    }
    this.addLink('JavStore', elLink, serialNumber, item, javstoreUrl)
    useSisterStore().updateInfo({ serialNumber, javStoreUrl: javstoreUrl })
    return javstoreUrl
  }

  private resolveTitle(javstoreDetail: Document, serialNumber: string) {
    const title = getTitleFromDetail(javstoreDetail)
    if (!title) return
    const likeWords = useConfigStore().common.keyword.like.filter((word) => title.includes(word))
    const unlikeWords = useConfigStore().common.keyword.unlike.filter((word) => title.includes(word))
    useSisterStore().updateInfo({ serialNumber, likeWords, unlikeWords })
  }

  private async updateImgUrl(
    javstoreDetail: Document,
    serialNumber: string,
    thumbnail: JQuery,
    elLink: JQuery,
    item: JQuery,
    javstoreUrl: string
  ) {
    const imgUrl = await getThumbnailUrlFromDetail(javstoreDetail, serialNumber)
    if (imgUrl.length === 0) {
      const failed = [picx('/failed.svg')]
      useSisterStore().updateInfo({ serialNumber, src: failed, status: SisterStatus.ImageUrlMissing })
      this.updateThumbnail(serialNumber, thumbnail, failed)
      this.addLink('图片获取失败', elLink, serialNumber, item, javstoreUrl)
      return
    }
    useSisterStore().updateInfo({ serialNumber, src: imgUrl, status: SisterStatus.ImageReady })
    this.updateThumbnail(serialNumber, thumbnail, imgUrl)
    if (useSisterStore().current_key === serialNumber) {
      markReadIfReady(serialNumber)
    }
  }

  private async updateRepeat(serialNumber: string, info: Info) {
    const histories = await getHistories([serialNumber])
    const haveRead = histories.length > 0
    useSisterStore().updateInfo({ serialNumber, haveRead })
    if (!haveRead) return

    const repeats = histories.filter((item) => item.path_date !== info.pathDate || item.site !== info.site)
    if (repeats.length > 0) {
      console.log('发现重复已读', repeats)
      useSisterStore().updateInfo({ serialNumber, repeatSite: this.site.siteId })
      const otherSite = repeats.find((item) => item.site !== info.site)
      if (otherSite !== undefined) {
        useSisterStore().updateInfo({ serialNumber, repeatSite: otherSite.site })
      }
    }

    if (info.pathDate !== undefined) {
      const sameRecord = histories.find((item) => item.path_date === info.pathDate && item.site === info.site)
      if (sameRecord === undefined) {
        uploadHistory(serialNumber, info)
          .then()
          .catch((error) => console.error('补传浏览历史失败', serialNumber, error))
      }
    }
  }
}
