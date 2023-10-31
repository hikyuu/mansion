import type { History } from './onejav/onejav-history'

export class RealmTask {
  limit: number

  private waitQueue: Array<History> = []

  workNumber: number = 0

  constructor(limit: number = 20) {
    this.limit = limit
  }

  addTask(history: History, task: Function) {
    this.waitQueue.push(history)
    this.run(task)
  }

  run(work: Function) {
    if (this.workNumber >= this.limit) return
    if (this.waitQueue.length <= 0) return
    this.workNumber++
    const history = this.waitQueue.shift()
    if (history) {
      work(history).then(() => {
        this.workNumber--
        this.run(work)
      })
    }
  }
}
