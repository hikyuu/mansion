import { defineStore } from 'pinia'
import { GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client'
// 你可以任意命名 `defineStore()` 的返回值，但最好使用 store 的名字，同时以 `use` 开头且以 `Store` 结尾。
// (比如 `useUserStore`，`useCartStore`，`useProductStore`)
// 第一个参数是你的应用中 Store 的唯一 ID。
export const useConfigStore = defineStore('config', {
  state: (): State => {
    return {
      waterfall: new Map(),
      currentConfig: getDefaultWaterfall()
    }
  },
  getters: {},
  actions: {
    loadLocalConfig(name: string) {
      const state = GM_getValue('config', this.$state as LocalState)
      console.log('读取配置文件', name, state)
      state.waterfall = new Map()
      const defaultWaterfall = getDefaultWaterfall()
      if (!state.waterfallJsonObject) {
        state.waterfall.set(name, defaultWaterfall)
      } else {
        state.waterfall = new Map(Object.entries(state.waterfallJsonObject))
      }
      if (!state.waterfall.has(name)) {
        state.waterfall.set(name, defaultWaterfall)
      }
      const config = state.waterfall.get(name)
      state.currentConfig = config ? config : defaultWaterfall
      for (const key in defaultWaterfall) {
        if (!(key in state.currentConfig)) {
          state.currentConfig[key] = defaultWaterfall[key]
        }
      }
      this.$patch(state)
      console.log('当前配置', this.$state)
    },

    saveLocal() {
      const localSate = {
        ...this.$state,
        waterfallJsonObject: Object.fromEntries(this.waterfall)
      } as LocalState
      GM_setValue('config', localSate)
      console.log('保存配置文件', localSate)
    }
  }
})

function getDefaultWaterfall() {
  return {
    loadPreviewSwitch: true,
    scrollStatus: 1,
    smooth: 1,
    navigationPoint: 0,
    skipRead: false,
    keyword: {
      like: [],
      unlike: []
    }
  } as Waterfall
}

interface State {
  waterfall: Map<string, Waterfall>
  currentConfig: Waterfall
}
interface LocalState extends State {
  waterfallJsonObject: object
}

export interface Waterfall {
  loadPreviewSwitch: boolean
  scrollStatus: number
  smooth: number
  navigationPoint: number
  skipRead: boolean
  keyword: {
    like: string[]
    unlike: string[]
  }
  [key: string]: any
}
