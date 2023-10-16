import { SiteAbstract } from './site-abstract'

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
    this.waitQueue.push(elem)
    this.run()
  }
  run() {
    if (this.workNumber >= this.limit) return
    if (this.waitQueue.length <= 0) return
    console.log('开始工作')
    this.workNumber++
    const elem = this.waitQueue.shift()
    if (elem) {
      this.work(elem).then(() => {
        this.workNumber--
        this.run()
      })
    }
  }
  async work(elem: JQuery) {
    return this.site.addPreview(elem)
  }
}
