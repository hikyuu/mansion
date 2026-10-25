// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlockedError } from '@/common/cloudflare'

const mocks = vi.hoisted(() => ({
  fetchPage: vi.fn<(input: unknown) => Promise<unknown>>()
}))

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_addStyle: vi.fn<(css: string) => void>(),
  GM_cookie: { list: vi.fn<(details: unknown, cb: unknown) => void>() },
  monkeyWindow: {}
}))
vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))
vi.mock('@/common/cloudflare-guard', () => ({ fetchPageThroughCloudflare: mocks.fetchPage }))

const DETAIL = '/torrent/abf274/download/94029137/onejav.com_abf274.torrent'
const TORRENT_URL = 'https://onejav.com' + DETAIL

const DOWNLOAD_HTML = `<html><body><div class="card"><a title="Download .torrent" href="${DETAIL}">Download</a></div></body></html>`

interface PageOverrides {
  url?: string
  status?: number
  html?: string
  headers?: Record<string, string>
  via?: 'direct' | 'fallback'
}

function page(overrides: PageOverrides = {}) {
  return {
    url: TORRENT_URL,
    status: 200,
    html: DOWNLOAD_HTML,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    via: 'direct',
    ...overrides
  }
}

async function resolve() {
  const { resolveOnejavTorrent } = await import('@/site/onejav/onejav-api')
  return resolveOnejavTorrent(DETAIL)
}

beforeEach(() => {
  mocks.fetchPage.mockReset()
})

describe('resolveOnejavTorrent', () => {
  it('详情页 HTML 命中下载按钮时拼出种子地址', async () => {
    mocks.fetchPage.mockResolvedValue(page())

    await expect(resolve()).resolves.toBe(TORRENT_URL)
  })

  it('响应本身就是种子二进制时把最终地址当直链', async () => {
    mocks.fetchPage.mockResolvedValue(
      page({
        url: 'https://file.onejav.com/torrent/abf274.torrent',
        html: 'd8:announce30:http://tracker.example/announce4:infod4:name8:abf274e',
        headers: { 'content-type': 'application/x-bittorrent' }
      })
    )

    await expect(resolve()).resolves.toBe('https://file.onejav.com/torrent/abf274.torrent')
  })

  it('拦截页经兜底取回后仍能解析下载地址', async () => {
    mocks.fetchPage.mockResolvedValue(page({ via: 'fallback' }))

    await expect(resolve()).resolves.toBe(TORRENT_URL)
    expect(mocks.fetchPage).toHaveBeenCalledWith(expect.objectContaining({ site: 'onejav', url: TORRENT_URL }))
  })

  it('兜底仍被拦截时抛 CloudflareBlockedError，原因可直接进通知备注', async () => {
    mocks.fetchPage.mockRejectedValue(
      new CloudflareBlockedError(
        'onejav',
        { kind: 'challenge', status: 403, rayId: '8f2a1c3b', evidence: '页面特征 just a moment' },
        'FlareSolverr 兜底未成功：请求超时'
      )
    )

    await expect(resolve()).rejects.toThrow('onejav 被 Cloudflare 拦截（挑战页，Ray 8f2a1c3b），FlareSolverr 兜底未成功：请求超时')
  })

  it('页面正常但没有下载按钮时返回 null（不误报成拦截）', async () => {
    mocks.fetchPage.mockResolvedValue(page({ html: '<html><body>没有种子</body></html>' }))

    await expect(resolve()).resolves.toBeNull()
  })
})
