import { defineStore } from 'pinia'
import { GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client'
import { useSiteStore } from '@/store/site-store.ts'
import { LIKE } from '@/store/like.ts'
import { UNLIKE } from '@/store/unlike.ts'

// 你可以任意命名 `defineStore()` 的返回值，但最好使用 store 的名字，同时以 `use` 开头且以 `Store` 结尾。
// (比如 `useUserStore`，`useCartStore`，`useProductStore`)
// 第一个参数是你的应用中 Store 的唯一 ID。

interface Config {
  common: {
    sessionId: MsSession[]
    keyword: {
      like: string[]
      unlike: string[]
    }
  }
  sites: Map<string, SiteConfig>
}

interface SiteConfig {
  loadThumbnailSwitch: boolean
  scrollStatus: number
  smooth: number
  downloadMethod: number
  navigationPoint: number
  skipRead: boolean
  lazyLimit: number
}
function getDefaultSiteConfig(): SiteConfig {
  return {
    loadThumbnailSwitch: true,
    scrollStatus: 1,
    smooth: 1,
    downloadMethod: 0,
    navigationPoint: 0,
    skipRead: false,
    lazyLimit: 100
  }
}
export const useConfigStore = defineStore('config', {
  state: (): Config => {
    return {
      common: {
        sessionId: [],
        keyword: {
          like: [],
          unlike: []
        }
      },
      sites: new Map<string, SiteConfig>()
    }
  },
  getters: {
    getSiteConfig(): SiteConfig {
      const name = useSiteStore().getSite.name
      if (!this.sites.has(name) || !this.sites.get(name)) {
        throw new Error('没有找到站点配置')
      }
      return this.sites.get(name)!
    }
  },
  actions: {
    loadConfig() {
      // GM_deleteValue('mansion-config')
      const json = GM_getValue('mansion-config')
      // console.log('加载配置文件', json)
      const name = useSiteStore().getSite.name
      const siteConfig = getDefaultSiteConfig()
      if (json) {
        const config: Config = JSON.parse(json, reviver)
        console.log('读取配置文件', config)
        if (config.sites.has(name)) {
          const userSiteConfig = config.sites.get(name)
          // 合并配置，添加新字段
          Object.assign(siteConfig, userSiteConfig)
        }
        config.sites.set(name, siteConfig)
        config.common.keyword.like = LIKE
        config.common.keyword.unlike = UNLIKE
        this.$patch(config)
      } else {
        this.sites.set(name, siteConfig)
      }
    },
    saveConfig() {
      const config = JSON.stringify(this.$state, replacer)
      GM_setValue('mansion-config', config)
      console.log('保存配置文件', config)
    },
    updateSessionId(site: string, id: string) {
      this.common.sessionId.push({ site, id })
    }
  }
})
interface MsSession {
  site: string
  id: string
}
function replacer(key: string, value: unknown): unknown {
  // console.log('Processing key:', key, 'value type:', typeof value, 'value:', value)

  // 如果当前的值是一个 Map，则将其转换为普通对象
  // console.log('Raw value:', rawValue, 'is Map:', rawValue instanceof Map)
  if (value instanceof Map) {
    const entries = Object.fromEntries(value)
    return { dataType: 'Map', value: entries } as MapValue // 添加标识属性
    // 否则返回原值
  }
  return value
}

function reviver(key: string, value: unknown): unknown {
  // 检查当前值是否为一个对象，并且包含我们约定的标识属性
  // 如果该对象的 dataType 标识为 'Map'，则将其 value 属性（键值对数组）转换为 Map
  if (value !== null && typeof value === 'object' && 'dataType' in value && value.dataType === 'Map') {
    return new Map(Object.entries((value as MapValue).value))
    // 可以在此处扩展，用于识别和恢复其他特殊类型，如 Set, Date 等
    // else if (value.dataType === 'Set') { ... }
    // 如果不是我们约定的特殊标记对象，则直接返回值
  }
  return value
}

interface MapValue {
  dataType: string
  value: object
}
