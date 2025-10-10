import { defineStore } from 'pinia'
import { ElNotification } from 'element-plus'

export const useReactStore = defineStore('react', {
  state: (): {
    wgt1670: boolean
    hgt700: boolean
    isActive: boolean
  } => {
    return {
      wgt1670: window.innerWidth >= 1670,
      hgt700: window.innerHeight >= 700,
      isActive: true
    }
  },
  getters: {},
  actions: {
    listen() {
      window.addEventListener('resize', () => {
        this.wgt1670 = window.innerWidth >= 1670
        this.hgt700 = window.innerHeight >= 700
      })
    },
    reverseActive() {
      this.isActive = !this.isActive
      ElNotification({ title: '瀑布流', message: this.isActive ? '任务开始' : '任务暂停', type: 'info' })
    }
  }
})
