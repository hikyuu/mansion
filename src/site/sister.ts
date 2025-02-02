import $ from 'jquery'
import { ElNotification } from 'element-plus'
import { ProjectError } from '@/common/errors'

export class Sister {
  current_index: number | undefined = undefined
  current_key: string | undefined = undefined
  queue: Array<Info> = []
  sisterNumber = 0

  lastUnread(y: any) {
    const index = this.queue.findIndex((sister) => {
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
  }

  previous() {
    // console.log(this)
    if (!this.current_key || this.current_index === undefined || this.current_index <= 0) return
    const $image = $('#show-image')
    const info = this.queue[this.current_index]
    const scrollTop = $image.scrollTop()
    if (info) info.scrollTop = scrollTop ? scrollTop : 0
    this.setCurrentIndex(this.current_index - 1)
    this.current_key = this.queue[this.current_index].serialNumber
  }

  nextStep() {
    if (!this.current_key || this.current_index === undefined) return
    if (this.current_index >= this.queue.length - 1) return
    const $image = $('#show-image')
    const info = this.queue[this.current_index]
    const scrollTop = $image.scrollTop()
    if (info) info.scrollTop = scrollTop ? scrollTop : 0
    this.setCurrentIndex(this.current_index + 1)
    this.current_key = this.queue[this.current_index].serialNumber
  }

  setCurrent(serialNumber: string) {
    const index = this.queue.findIndex((item) => item.serialNumber === serialNumber)
    if (index >= 0) {
      console.debug('当前下标：', index)
      this.setCurrentIndex(index)
      this.current_key = serialNumber
    }
  }

  setCurrentIndex(index: number) {
    this.current_index = index
  }

  updateInfo(info: Info) {
    if (info.serialNumber === '') {
      ElNotification.error({ title: '错误', message: 'serialNumber为空' })
      throw new Error('serialNumber')
    }
    if (this.queue.length <= 0) {
      this.current_index = 0
      this.current_key = info.serialNumber
    }
    let existInfo = this.queue.find((item) => item.serialNumber === info.serialNumber)
    if (existInfo === undefined) {
      existInfo = info as Info
      existInfo.serialNumber = info.serialNumber
      this.queue.push(existInfo)
    } else {
      Object.assign(existInfo, info)
    }
    return existInfo
  }

  getScrollTop(index: number) {
    console.log(index, this.queue.length)
    if (index > this.queue.length - 1) {
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '当前页面还没有这么多内容'
      })
    }
    const nextPreview = $('#' + this.queue[index].serialNumber).find('#preview')
    if (nextPreview.length === 0) {
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '没有找到预览图'
      })
    }
    const offset = nextPreview.offset()
    if (offset === undefined) {
      throw new ProjectError({
        name: 'GET_PROJECT_ERROR',
        message: '没有找到预览图'
      })
    }
    return offset.top
  }

  deleteInfo(serialNumber: string) {
    const index = this.queue.findIndex((item) => item.serialNumber === serialNumber)
    if (index >= 0) {
      this.queue.splice(index, 1)
    }
  }
}

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
