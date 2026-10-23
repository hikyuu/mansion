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
    /** miao 本地服务连接配置（全局，与站点无关） */
    miao: MiaoConfig
  }
  sites: Map<string, SiteConfig>
}

/** 下载方式：miao 优先（默认，失败回退迅雷）/ 迅雷协议 / 复制链接 */
export type DownloadMethod = 'miao' | 'thunder' | 'copy'

/** miao 本地服务连接配置 */
export interface MiaoConfig {
  /** 下载保存目录（miao 服务端视角的路径），须命中 miao 下载目录白名单 */
  savePath: string
  /** miao REST 服务地址，默认 http://127.0.0.1:6427 */
  baseUrl: string
}

interface SiteConfig {
  loadThumbnailSwitch: boolean
  scrollStatus: number
  smooth: number
  downloadMethod: DownloadMethod
  navigationPoint: number
  skipRead: boolean
  lazyLimit: number
  /** 仅 exhentai：是否只显示可下载的画廊（隐藏已下载/跳过/无种子的条目） */
  onlyShowDownloadable: boolean
}

const DEFAULT_MIAO_BASE_URL = 'http://127.0.0.1:6427'

export function getDefaultMiaoConfig(): MiaoConfig {
  return {
    savePath: '',
    baseUrl: DEFAULT_MIAO_BASE_URL
  }
}

/**
 * 归一化 downloadMethod。
 * 旧配置存的是 number（0 迅雷 / 1 复制）且从未有过设置 UI，
 * 凡非合法字符串值一律迁移为 'miao'（miao 优先，全员默认）。
 */
export function normalizeDownloadMethod(value: unknown): DownloadMethod {
  return value === 'thunder' || value === 'copy' || value === 'miao' ? value : 'miao'
}

/** 老配置没有 common.miao 字段，补齐默认值；非法字段回退默认值 */
export function mergeMiaoConfig(saved: unknown): MiaoConfig {
  const defaults = getDefaultMiaoConfig()
  if (!saved || typeof saved !== 'object') return defaults
  const partial = saved as Partial<MiaoConfig>
  return {
    savePath: typeof partial.savePath === 'string' ? partial.savePath : defaults.savePath,
    baseUrl: typeof partial.baseUrl === 'string' && partial.baseUrl ? partial.baseUrl : defaults.baseUrl
  }
}

function getDefaultSiteConfig(): SiteConfig {
  return {
    loadThumbnailSwitch: true,
    scrollStatus: 1,
    smooth: 1,
    downloadMethod: 'miao',
    navigationPoint: 0,
    skipRead: false,
    lazyLimit: 100,
    onlyShowDownloadable: false
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
        },
        miao: getDefaultMiaoConfig()
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
        // 老配置没有 common.miao 字段，补齐默认值
        config.common.miao = mergeMiaoConfig(config.common.miao)
        // 旧 downloadMethod 为 number（0 迅雷 / 1 复制）且从未有过 UI，统一迁移为 'miao' 优先
        for (const siteConfig of config.sites.values()) {
          if (siteConfig) siteConfig.downloadMethod = normalizeDownloadMethod(siteConfig.downloadMethod)
        }
        if (config.sites.has(name)) {
          const userSiteConfig = config.sites.get(name)
          // 合并配置，添加新字段
          if (userSiteConfig) Object.assign(siteConfig, userSiteConfig)
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
