import { defineStore } from 'pinia'
import { ElNotification } from 'element-plus'
import { ProjectError } from '@/common/errors'
import jquery from 'jquery'
import { THUMBNAIL_ID } from '@/common/common'
import type { WritableComputedRef } from 'vue'
import { SiteId } from '@/site/site-id'

/**
 * 妹妹的加载/已读状态码，替代散落在缩略图链路与记账处的裸数字。
 * 注意：**已读的唯一真值是 haveRead**；status 只记录缩略图链路的阶段
 * （Read 仅随浏览历史记账同步写入，供界面沿用旧语义）。
 */
export enum SisterStatus {
  /** 刚建 Info，缩略图未就绪 */
  Created = 100,
  /** 大图就绪，可展示可导航（未读） */
  ImageReady = 202,
  /** 浏览历史记账成功，即已读 */
  Read = 200,
  /** javstore 条目或详情页找不到 */
  NotFound = 404,
  /** 详情页里没有大图地址 */
  ImageUrlMissing = 405,
  /** 番号认不出，搜索变体解析失败 */
  SerialUnparsable = 500,
  /** 图片加载错误（保留位） */
  ImageLoadFailed = 501
}

export const useSisterStore = defineStore('sister', {
  state: (): {
    current_index: number | undefined
    current_key: string | undefined
    sisterNumber: number
    _queue: Array<Info>
    _queueMap: Map<string, Info>
    _haveReadSet: Set<string>
    _trimmedSerials: Set<string>
  } => {
    return {
      current_index: undefined as number | undefined,
      current_key: undefined as string | undefined,
      sisterNumber: 0,
      _queue: [] as Array<Info>,
      _queueMap: new Map<string, Info>(),
      _haveReadSet: new Set<string>(),
      _trimmedSerials: new Set<string>()
    }
  },
  getters: {
    size(): number {
      return this._queue.length
    },
    currentSister(): Info | undefined {
      if (this.current_index === undefined) return undefined
      return this._queue[this.current_index]
    },
    haveReadNumber(): number {
      return this._haveReadSet.size
    }
  },
  actions: {
    getInfo(serialNumber: string): Info | undefined {
      return this._queueMap.get(serialNumber)
    },
    nextUnread(y: WritableComputedRef<number, number>) {
      const index = this._queue.findIndex((sister) => {
        if (!sister.haveRead && sister.status === SisterStatus.ImageReady) {
          return true
        }
      })
      if (index === -1) {
        ElNotification({ title: '提示', message: '没有未读的图片', type: 'info' })
        return
      }
      try {
        const scrollTop = this.getScrollTop(index)
        console.log('坐标：', scrollTop)
        y.value = scrollTop
      } catch (reason: unknown) {
        if (reason instanceof Error) {
          ElNotification({ title: '提示', message: reason.message, type: 'error' })
        } else {
          ElNotification({ title: '提示', message: '未知错误', type: 'error' })
          console.error('未知错误:', reason)
        }
      }
    },
    previous() {
      // console.log(this)
      if (!this.current_key || this.current_index === undefined || this.current_index <= 0) return
      const $image = jquery('#show-image')
      const info = this._queue[this.current_index]
      const scrollTop = $image.scrollTop()
      if (info) info.scrollTop = scrollTop ? scrollTop : 0
      this.setCurrentIndex(this.current_index - 1)
      this.current_key = this._queue[this.current_index]!.serialNumber
    },
    nextStep() {
      if (!this.current_key || this.current_index === undefined) return
      if (this.current_index >= this._queue.length - 1) return
      const $image = jquery('#show-image')
      const info = this._queue[this.current_index]
      const scrollTop = $image.scrollTop()
      if (info) info.scrollTop = scrollTop ? scrollTop : 0
      this.setCurrentIndex(this.current_index + 1)
      this.current_key = this._queue[this.current_index]!.serialNumber
    },
    setCurrent(serialNumber: string) {
      const index = this._queue.findIndex((item) => item.serialNumber === serialNumber)
      if (index >= 0) {
        console.debug('当前下标：', index)
        this.setCurrentIndex(index)
        this.current_key = serialNumber
      }
    },
    setCurrentIndex(index: number) {
      this.current_index = index
    },

    updateInfo(info: Info): Info | undefined {
      if (info.serialNumber === '') {
        ElNotification.error({ title: '错误', message: 'serialNumber为空' })
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: 'serialNumber为空'
        })
      }
      let existInfo = this._queueMap.get(info.serialNumber)
      if (existInfo === undefined) {
        // 被裁掉的条目可能还有迟到的缩略图回调（任务队列是异步的）：
        // 页面上已经没有这张卡就不再建回来，否则队列会比 DOM 多出幽灵条目，下标全错位。
        // 判据是「裁过 + 页面上没有该节点」—— 分页里刚解析完还没插进 DOM 的卡片没有墓碑，照常建。
        const gone = typeof document === 'undefined' || document.getElementById(info.serialNumber) === null
        if (this._trimmedSerials.has(info.serialNumber) && gone) {
          console.warn('条目已从页面裁掉，不再建回队列', info.serialNumber)
          return undefined
        }
        // 同一番号又出现在后面的分页里：节点回到页面，墓碑撤销
        this._trimmedSerials.delete(info.serialNumber)
        existInfo = info as Info
        existInfo.serialNumber = info.serialNumber
        this._queue.push(existInfo)
        this._queueMap.set(info.serialNumber, existInfo)
      } else {
        Object.assign(existInfo, info)
      }
      if (existInfo.haveRead === undefined) {
        existInfo.haveRead = false
      }
      if (existInfo.loadCompleted === undefined) {
        existInfo.loadCompleted = false
      }
      if (existInfo.haveRead) {
        this._haveReadSet.add(existInfo.serialNumber)
      }
      return existInfo
    },

    getScrollTop(index: number) {
      console.log(index, this._queue.length)
      if (index > this._queue.length - 1) {
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: '当前页面还没有这么多内容'
        })
      }
      const nextThumbnail = jquery('#' + this._queue[index]!.serialNumber).find(`#${THUMBNAIL_ID}`)
      if (nextThumbnail.length === 0) {
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: '没有找到缩略图'
        })
      }
      const offset = nextThumbnail.offset()
      if (offset === undefined) {
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: '没有找到缩略图'
        })
      }
      return offset.top
    },
    deleteInfo(serialNumber: string) {
      const info = this._queueMap.get(serialNumber)
      if (!info) {
        return
      }
      this._queueMap.delete(serialNumber)
      const index = this._queue.findIndex((item) => item.serialNumber === serialNumber)
      if (index >= 0) {
        this._queue.splice(index, 1)
      }
    },
    /**
     * 已读溢出窗口：以当前条目为锚点，保留它连同它上方共 limit 条，
     * 位置在窗口之前的已读番号都算溢出。
     *
     * 锚点必须是当前条目而不是已读总数 —— 已读数会因回看、历史灌入而涨得很快，
     * 拿它当尺子会在用户还停在列表上方时就把眼前的卡片删掉。
     * 未读卡片不算溢出：它们还没被看过，删掉等于丢内容。
     */
    readOverflow(limit: number): string[] {
      if (this.current_index === undefined) return []
      const start = this.current_index - limit + 1
      if (start <= 0) return []
      return this._queue
        .slice(0, start)
        .map((info) => info.serialNumber)
        .filter((serialNumber) => this._haveReadSet.has(serialNumber))
    },
    /**
     * 忘掉一批已读：卡片已经离开页面，store 里不留残影。
     * 队列、番号集合与当前下标一起对齐，否则 getScrollTop / nextUnread 会踩空。
     * 同时留一枚墓碑，拦住迟到的缩略图回调把已裁条目重新建回来。
     */
    forgetRead(serialNumbers: string[]) {
      if (serialNumbers.length === 0) return
      const dropping = new Set(serialNumbers)
      serialNumbers.forEach((serialNumber) => {
        this._haveReadSet.delete(serialNumber)
        this._trimmedSerials.add(serialNumber)
      })
      this._queue = this._queue.filter((item) => {
        if (!dropping.has(item.serialNumber)) return true
        this._queueMap.delete(item.serialNumber)
        return false
      })
      if (this.current_key === undefined) return
      const index = this._queue.findIndex((item) => item.serialNumber === this.current_key)
      if (index >= 0) this.current_index = index
    }
  }
})
export declare interface Info {
  serialNumber: string
  loadCompleted?: boolean
  haveRead?: boolean
  javStoreUrl?: string
  scrollTop?: number
  repeatSite?: SiteId
  src?: string[]
  date?: string
  pathDate?: string
  likeWords?: string[]
  unlikeWords?: string[]
  status?: SisterStatus
  site?: SiteId // 0 unknown 1 onejav 2 javdb
}
