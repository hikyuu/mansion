import { SiteAbstract } from './site-abstract'
import { ProjectError } from '@/common/errors'

export class Task {
  limit: number

  site: SiteAbstract

  private waitQueue: Array<JQuery> = []

  workNumber: number = 0

  constructor(site: SiteAbstract, limit: number = 2) {
    this.limit = limit
    this.site = site
  }

  addTask(elem: JQuery) {
    console.debug('添加任务')
    this.waitQueue.push(elem)
    this.run()
  }

  addTasks(elem: JQuery[]) {
    console.debug('添加任务')
    this.waitQueue.push(...elem)
    this.run()
  }

  run() {
    if (this.workNumber >= this.limit) return
    if (this.waitQueue.length <= 0) return
    console.debug('开始工作')
    this.workNumber++
    const elem = this.waitQueue.shift()
    if (elem) {
      const serialNumber = this.site.sortSerialNumber(elem)
      this.work(serialNumber, elem)
        .then()
        .catch((reason) => {
          if (reason instanceof ProjectError) {
            console.log('已知异常：', reason.message)
          } else {
            console.log('未知异常：', reason)
          }
        })
        .finally(() => {
          this.site.infoLoadCompleted(serialNumber)
          this.workNumber--
          this.run()
        })
    }
  }

  async work(serialNumber: string, elem: JQuery) {
    return this.site.processThumbnail(serialNumber, elem)
  }

  runAll() {
    const elem = this.waitQueue.shift()
    if (elem) {
      const serialNumber = this.site.sortSerialNumber(elem)
      this.site.processThumbnail(serialNumber, elem, 0, true).then(() => {
        this.runAll()
      })
    }
  }
}
