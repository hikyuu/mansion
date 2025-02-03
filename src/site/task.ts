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

  run() {
    if (this.workNumber >= this.limit) return
    if (this.waitQueue.length <= 0) return
    console.debug('开始工作')
    this.workNumber++
    const elem = this.waitQueue.shift()
    if (elem) {
      this.work(elem)
        .then()
        .catch((reason) => {
          if (reason instanceof ProjectError) {
            console.log(reason.message)
          }
        })
        .finally(() => {
          this.workNumber--
          this.run()
        })
    }
  }

  async work(elem: JQuery) {
    return this.site.addPreview(elem).catch((reason) => {
      console.error(reason.message)
    })
  }

  runAll() {
    const elem = this.waitQueue.shift()
    if (elem) {
      this.site.addPreview(elem, 0, true).then(() => {
        this.runAll()
      })
    }
  }
}
