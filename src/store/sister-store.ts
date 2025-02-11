import { defineStore } from 'pinia'
import { ElNotification } from 'element-plus'
import { ProjectError } from '@/common/errors'
import $ from 'jquery'
import { THUMBNAIL_ID } from '@/common/common'

export const useSisterStore = defineStore('sister', {
  state: (): {
    current_index: number | undefined
    current_key: string | undefined
    sisterNumber: number
    _queue: Array<Info>
    _queueMap: Map<string, Info>
    _haveReadSet: Set<string>
  } => {
    return {
      current_index: undefined as number | undefined,
      current_key: undefined as string | undefined,
      sisterNumber: 0,
      _queue: [] as Array<Info>,
      _queueMap: new Map<string, Info>(),
      _haveReadSet: new Set<string>()
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
    lastUnread(y: any) {
      const index = this._queue.findIndex((sister) => {
        if (!sister.haveRead) {
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
      } catch (reason: any) {
        ElNotification({ title: '提示', message: reason, type: 'info' })
      }
    },
    previous() {
      // console.log(this)
      if (!this.current_key || this.current_index === undefined || this.current_index <= 0) return
      const $image = $('#show-image')
      const info = this._queue[this.current_index]
      const scrollTop = $image.scrollTop()
      if (info) info.scrollTop = scrollTop ? scrollTop : 0
      this.setCurrentIndex(this.current_index - 1)
      this.current_key = this._queue[this.current_index].serialNumber
    },
    nextStep() {
      if (!this.current_key || this.current_index === undefined) return
      if (this.current_index >= this._queue.length - 1) return
      const $image = $('#show-image')
      const info = this._queue[this.current_index]
      const scrollTop = $image.scrollTop()
      if (info) info.scrollTop = scrollTop ? scrollTop : 0
      this.setCurrentIndex(this.current_index + 1)
      this.current_key = this._queue[this.current_index].serialNumber
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

    updateInfo(info: Info) {
      if (info.serialNumber === '') {
        ElNotification.error({ title: '错误', message: 'serialNumber为空' })
        throw new ProjectError({
          name: 'GET_PROJECT_ERROR',
          message: 'serialNumber为空'
        })
      }
      let existInfo = this._queueMap.get(info.serialNumber)
      if (existInfo === undefined) {
        existInfo = info as Info
        existInfo.serialNumber = info.serialNumber
        this._queue.push(existInfo)
        this._queueMap.set(info.serialNumber, existInfo)
      } else {
        Object.assign(existInfo, info)
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
      const nextThumbnail = $('#' + this._queue[index].serialNumber).find(`#${THUMBNAIL_ID}`)
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
    }
  }
})
export declare interface Info {
  serialNumber: string
  javStoreUrl?: string
  scrollTop?: number
  repeatSite?: number
  src?: string[]
  date?: string
  haveRead?: boolean
  pathDate?: string
  likeWords?: string[]
  unlikeWords?: string[]
  status?: number //200：成功，404：不存在 405：图片地址获取失败 500:id格式错误 501：图片加载错误
  site?: number // 0 unknown 1 onejav 2 javdb
}
