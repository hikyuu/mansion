import { describe, expect, it, vi } from 'vitest'
import { SiteId } from '@/site/site-id'
import { classifyDownloadUrl, decideMiaoAction, pickTaskKind } from '@/download/miao.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  monkeyWindow: {}
}))
vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))
vi.mock('@/store/config-store.ts', () => ({ useConfigStore: vi.fn<() => unknown>() }))
vi.mock('@/store/site-store.ts', () => ({ useSiteStore: vi.fn<() => unknown>() }))
vi.mock('@/download/gm-fetch.ts', () => ({
  gmFetch: vi.fn<(input: unknown, init?: unknown) => Promise<Response>>()
}))
vi.mock('@/download/file-picker.ts', () => ({
  requestFileSelection: vi.fn<(payload: unknown) => Promise<number[] | null>>()
}))

describe('classifyDownloadUrl', () => {
  it('磁链（含大小写与前后空白）归为 magnet', () => {
    expect(classifyDownloadUrl('magnet:?xt=urn:btih:624ed719aaf2205a5c7b4c72a6a0c97e7f66b0e2')).toBe('magnet')
    expect(classifyDownloadUrl('MAGNET:?xt=urn:btih:624ed719')).toBe('magnet')
    expect(classifyDownloadUrl('  magnet:?xt=urn:btih:624ed719&dn=a&b=c  ')).toBe('magnet')
    expect(classifyDownloadUrl('magnet:?xt=urn:btih:624ed719&tr=http%3A%2F%2Ft%2Fa%3Fx%3D1')).toBe('magnet')
  })

  it('远程 .torrent / .zip / /torrent/ 路径归为 torrent', () => {
    expect(classifyDownloadUrl('https://exhentai.org/torrent/123456/abc.torrent')).toBe('torrent')
    expect(classifyDownloadUrl('https://exhentai.org/torrent/123456/abc.zip')).toBe('torrent')
    expect(classifyDownloadUrl('https://onejav.com/torrent/abf274/download/94029137/onejav.com_abf274.torrent')).toBe(
      'torrent'
    )
    // 查询串不影响路径判定
    expect(classifyDownloadUrl('https://exhentai.org/torrent/1/a.torrent?passkey=xx')).toBe('torrent')
  })

  it('直链 / 页面 / 空串归为 other', () => {
    expect(classifyDownloadUrl('https://file.onejav.com/video.mp4')).toBe('other')
    expect(classifyDownloadUrl('https://javdb.com/v/abc123')).toBe('other')
    expect(classifyDownloadUrl('')).toBe('other')
    expect(classifyDownloadUrl('   ')).toBe('other')
    expect(classifyDownloadUrl('ed2k://file|a.mkv|1|2|/')).toBe('other')
  })
})

describe('pickTaskKind', () => {
  it('exhentai 用画廊任务', () => {
    expect(pickTaskKind(SiteId.EXHENTAI)).toBe('gallery')
  })

  it('其余站点用视频任务', () => {
    expect(pickTaskKind(SiteId.JAVDB)).toBe('video')
    expect(pickTaskKind(SiteId.ONEJAV)).toBe('video')
    expect(pickTaskKind(SiteId.JAVSTORE)).toBe('video')
    expect(pickTaskKind(SiteId.UNKNOWN)).toBe('video')
  })
})

describe('decideMiaoAction', () => {
  it('磁链 → 交给 miao', () => {
    expect(decideMiaoAction('magnet')).toEqual({ proceed: true, reason: '' })
  })

  it('远程种子 → 交给 miao（torrentBase64 直投）', () => {
    expect(decideMiaoAction('torrent')).toEqual({ proceed: true, reason: '' })
  })

  it('其它 URL → 回退并提示仅支持磁链与种子链接', () => {
    const decision = decideMiaoAction('other')
    expect(decision.proceed).toBe(false)
    expect(decision.reason).toContain('磁链')
    expect(decision.reason).toContain('种子')
  })
})
