import { defineStore } from 'pinia'
import { ElNotification } from 'element-plus'
import { SiteAbstract } from '@/site/site-abstract.ts'
import { useSiteStore } from '@/store/site-store.ts'
import { ProjectError } from '@/common/errors.ts'

export const useTaskStore = defineStore('task', {
  state: (): {
    isActive: boolean
    limit: number
    site: SiteAbstract
    waitQueue: Array<JQuery>
    workNumber: number
  } => {
    return {
      isActive: true,
      limit: 2,
      site: useSiteStore().getSite,
      waitQueue: [] as Array<JQuery>,
      workNumber: 0
    }
  },
  getters: {},
  actions: {
    reverseActive() {
      this.isActive = !this.isActive
      ElNotification({ title: '瀑布流', message: this.isActive ? '任务开始' : '任务暂停', type: 'info' })
      if (this.isActive) {
        this.run()
      }
    },
    addTasks(elem: JQuery[]) {
      console.debug('添加任务')
      this.waitQueue.push(...elem)
      this.run()
    },
    run() {
      if (this.workNumber >= this.limit) return
      if (this.waitQueue.length <= 0) return
      if (!this.isActive) return
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
    },
    async work(serialNumber: string, elem: JQuery) {
      return this.site.processThumbnail(serialNumber, elem)
    }
  }
})
