import $ from 'jquery'

export class Sisters {
  current_index: number | undefined = undefined
  current_key: string | null = null
  queue: Array<Info> = []
  sisterNumber = 0

  previous() {
    // console.log(this)
    if (!this.current_key || this.current_index === undefined || this.current_index <= 0) return
    const $image = $('#show-image')
    const info = this.queue[this.current_index]
    const scrollTop = $image.scrollTop()
    if (info) info.scrollTop = scrollTop ? scrollTop : 0

    this.current_index = this.current_index - 1
    this.current_key = this.queue[this.current_index].serialNumber

    const current = this.queue[this.current_index]
    if (current) $image.scrollTop(current.scrollTop ? current.scrollTop : 0)
  }

  nextStep() {
    if (!this.current_key || this.current_index === undefined) return
    if (this.current_index >= this.queue.length - 1) return

    const $image = $('#show-image')
    const info = this.queue[this.current_index]
    const scrollTop = $image.scrollTop()
    if (info) info.scrollTop = scrollTop ? scrollTop : 0

    this.current_index = this.current_index + 1
    this.current_key = this.queue[this.current_index].serialNumber

    const current = this.queue[this.current_index]
    if (current) $image.scrollTop(current.scrollTop ? current.scrollTop : 0)
  }

  setCurrent(serialNumber: string) {
    const index = this.queue.findIndex((item) => item.serialNumber === serialNumber)

    if (index >= 0) {
      this.current_index = index
      this.current_key = serialNumber
    }
  }

  updateInfo(info: Info) {
    if (info.serialNumber === '') return
    if (this.queue.length <= 0) {
      this.current_index = 0
      this.current_key = info.serialNumber
    }
    let existInfo = this.queue.find((item) => item.serialNumber === info.serialNumber)
    if (!existInfo) {
      existInfo = info as Info
      existInfo.serialNumber = info.serialNumber
      this.queue.push(existInfo)
    } else {
      Object.assign(existInfo, info)
    }
  }

  async getScrollTop(index: number) {
    console.log(index, this.queue.length)
    if (index > this.queue.length) {
      return Promise.reject('当前页面还没有这么多内容')
    }
    const nextPreview = $('#' + this.queue[index - 1].serialNumber).find('#preview')
    if (nextPreview.length === 0) return Promise.reject('没有找到预览图')

    const offset = nextPreview.offset()
    if (offset === undefined) return Promise.reject('没有找到预览图')

    return offset.top
  }
}

export declare interface Info {
  serialNumber: string
  scrollTop?: number
  src?: string
  date?: string
  haveRead?: boolean
  pathDate?: string
}
