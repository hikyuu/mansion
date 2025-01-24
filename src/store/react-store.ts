import { defineStore } from 'pinia'

export const useReactStore = defineStore('React', {
  state: (): {
    wgt1670: boolean
    hgt700: boolean
  } => {
    return {
      wgt1670: window.innerWidth >= 1670,
      hgt700: window.innerHeight >= 700
    }
  },
  getters: {},
  actions: {
    listen() {
      window.addEventListener('resize', () => {
        this.wgt1670 = window.innerWidth >= 1670
        this.hgt700 = window.innerHeight >= 700
      })
    }
  }
})
