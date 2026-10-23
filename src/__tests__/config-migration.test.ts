import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { GM_getValue } from 'vite-plugin-monkey/dist/client'
import {
  getDefaultMiaoConfig,
  mergeMiaoConfig,
  normalizeDownloadMethod,
  useConfigStore
} from '@/store/config-store.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  monkeyWindow: {}
}))
vi.mock('@/store/site-store.ts', () => ({
  useSiteStore: () => ({ getSite: { name: 'javdb' }, isValid: true })
}))

const gmGetMock = vi.mocked(GM_getValue)

/** 旧版持久化配置：downloadMethod 为 number，且 common 没有 miao 字段 */
function oldConfigJson(downloadMethod: unknown): string {
  return JSON.stringify({
    common: { sessionId: [], keyword: { like: [], unlike: [] } },
    sites: {
      dataType: 'Map',
      value: {
        javdb: {
          loadThumbnailSwitch: true,
          scrollStatus: 1,
          smooth: 1,
          downloadMethod,
          navigationPoint: 0,
          skipRead: false,
          lazyLimit: 100,
          onlyShowDownloadable: false
        },
        onejav: {
          loadThumbnailSwitch: true,
          scrollStatus: 1,
          smooth: 1,
          downloadMethod: 1,
          navigationPoint: 0,
          skipRead: false,
          lazyLimit: 100,
          onlyShowDownloadable: false
        }
      }
    }
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  gmGetMock.mockReset()
})

describe('normalizeDownloadMethod', () => {
  it('旧数字值（0 迅雷 / 1 复制）统一迁移为 miao 优先', () => {
    expect(normalizeDownloadMethod(0)).toBe('miao')
    expect(normalizeDownloadMethod(1)).toBe('miao')
  })

  it('合法字符串保留', () => {
    expect(normalizeDownloadMethod('miao')).toBe('miao')
    expect(normalizeDownloadMethod('thunder')).toBe('thunder')
    expect(normalizeDownloadMethod('copy')).toBe('copy')
  })

  it('未知字符串 / undefined / null / 对象回退 miao', () => {
    expect(normalizeDownloadMethod('foo')).toBe('miao')
    expect(normalizeDownloadMethod(undefined)).toBe('miao')
    expect(normalizeDownloadMethod(null)).toBe('miao')
    expect(normalizeDownloadMethod({})).toBe('miao')
  })
})

describe('mergeMiaoConfig', () => {
  it('缺字段补默认值', () => {
    expect(mergeMiaoConfig(undefined)).toEqual(getDefaultMiaoConfig())
    expect(mergeMiaoConfig(null)).toEqual(getDefaultMiaoConfig())
  })

  it('部分字段保留并补默认', () => {
    expect(mergeMiaoConfig({ savePath: 'L:\\Downloads' })).toEqual({
      savePath: 'L:\\Downloads',
      baseUrl: 'http://127.0.0.1:6427'
    })
  })

  it('非法字段类型回退默认值', () => {
    expect(mergeMiaoConfig({ savePath: 123, baseUrl: '' })).toEqual(getDefaultMiaoConfig())
    expect(mergeMiaoConfig('bad')).toEqual(getDefaultMiaoConfig())
  })
})

describe('loadConfig 迁移', () => {
  it('数字 downloadMethod 全部站点迁移为 miao，common.miao 补默认值', () => {
    gmGetMock.mockReturnValue(oldConfigJson(0))
    const store = useConfigStore()
    store.loadConfig()
    expect(store.getSiteConfig.downloadMethod).toBe('miao')
    // 非当前站点的旧配置同样迁移
    expect(store.sites.get('onejav')?.downloadMethod).toBe('miao')
    expect(store.common.miao).toEqual(getDefaultMiaoConfig())
  })

  it('字符串 downloadMethod 保留（不被迁移覆盖）', () => {
    gmGetMock.mockReturnValue(oldConfigJson('copy'))
    const store = useConfigStore()
    store.loadConfig()
    expect(store.getSiteConfig.downloadMethod).toBe('copy')
  })

  it('已有 common.miao 保留用户配置', () => {
    const json = JSON.parse(oldConfigJson(0)) as { common: { miao?: unknown } }
    json.common.miao = { savePath: 'D:\\dl', baseUrl: 'http://192.168.1.5:6427' }
    gmGetMock.mockReturnValue(JSON.stringify(json))
    const store = useConfigStore()
    store.loadConfig()
    expect(store.common.miao).toEqual({ savePath: 'D:\\dl', baseUrl: 'http://192.168.1.5:6427' })
  })

  it('无历史配置时默认即 miao 优先', () => {
    gmGetMock.mockReturnValue(undefined)
    const store = useConfigStore()
    store.loadConfig()
    expect(store.getSiteConfig.downloadMethod).toBe('miao')
    expect(store.common.miao).toEqual(getDefaultMiaoConfig())
  })
})
