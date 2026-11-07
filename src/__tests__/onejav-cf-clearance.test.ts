// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlockedError } from '@/common/cloudflare'
import type { PageFetchResult, ProxyResult } from '@/common/miao-proxy.ts'

/**
 * onejav.com「过 CF」的完整链路：onejav-api → cloudflare-guard（真实实现）→ miao 代取。
 *
 * 与 onejav-cloudflare.test.ts 的分工：那边把 guard 整体 mock 掉，只验「拦截抛错、正常解析」；
 * 这里保留真实 guard，只 mock 最外层的两条 IO（GM 请求、miao 代取通道），
 * 用来盯住 onejav 到底有没有把代取通道传下去、代取回来的页面有没有被正确采纳。
 */

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string, referer?: string, timeout?: number, options?: unknown) => Promise<unknown>>(),
  pageFetch: vi.fn<(url: string) => Promise<ProxyResult<PageFetchResult>>>()
}))

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_addStyle: vi.fn<(css: string) => void>(),
  GM_openInTab: vi.fn<(url: string, options?: unknown) => unknown>(),
  GM_cookie: { list: vi.fn<(details: unknown, cb: unknown) => void>() },
  monkeyWindow: {}
}))
vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))
vi.mock('@/common/common', () => ({ request: mocks.request }))
// onejav-api 从这里拿代取通道：链路对不对，就看它有没有被调用
vi.mock('@/download/miao-proxy.ts', () => ({ miaoPageFetch: mocks.pageFetch }))

const DETAIL = '/torrent/abf274'
const DETAIL_URL = 'https://onejav.com' + DETAIL
const LINK = '/torrent/abf274/download/94029137/onejav.com_abf274.torrent'
const SEED_URL = 'https://onejav.com' + LINK
const FILE_URL = 'https://file.onejav.com/torrent/abf274.torrent'
const TORRENT_BODY = 'd8:announce30:http://tracker.example/announce4:infod4:name6:abf274e'

const DOWNLOAD_HTML = `<html><body><div class="card">
  <a title="Download .torrent" href="${LINK}">Download</a>
</div></body></html>`

const CHALLENGE_HTML = '<html><head><title>Just a moment...</title></head></html>'

const TURNSTILE_HTML = `<html><body><div class="cf-turnstile" data-sitekey="0x4AAA"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`

/** 挑战页 / 正常页都带 cf-ray：站点整站在 CF 后面 */
const CF_HEADERS = 'server: cloudflare\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC\r\ncontent-type: text/html; charset=utf-8'

function gmPage(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    statusText: 'OK',
    responseHeaders: CF_HEADERS,
    responseText: DOWNLOAD_HTML,
    finalUrl: DETAIL_URL,
    ...overrides
  }
}

const PROXIED: ProxyResult<PageFetchResult> = {
  ok: true,
  url: DETAIL_URL,
  status: 200,
  html: DOWNLOAD_HTML,
  contentType: 'text/html; charset=utf-8'
}

async function api() {
  return import('@/site/onejav/onejav-api')
}

beforeEach(() => {
  mocks.request.mockReset()
  mocks.pageFetch.mockReset()
  mocks.pageFetch.mockResolvedValue(PROXIED)
})

describe('onejav.com 解析 · downloadHref 已是直链', () => {
  it('`.torrent` 直链直接返回，不发探测请求（GM 必被拦，探测只会白付一次 web.fetch）', async () => {
    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(LINK)).resolves.toBe(SEED_URL)

    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.pageFetch).not.toHaveBeenCalled()
  })

  it('file.onejav.com 直链同样短路', async () => {
    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(FILE_URL)).resolves.toBe(FILE_URL)

    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.pageFetch).not.toHaveBeenCalled()
  })
})

describe('onejav.com 过 CF · 首次请求就通过（浏览器已带 cf_clearance）', () => {
  it('按 onejav 的地址与 Referer 发请求，相对链接绝对化成种子地址', async () => {
    mocks.request.mockResolvedValue(gmPage())

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe(SEED_URL)

    expect(mocks.request).toHaveBeenCalledWith(DETAIL_URL, 'https://onejav.com/')
    // 已经过了就不该再让 miao 代取
    expect(mocks.pageFetch).not.toHaveBeenCalled()
  })

  it('详情页直接回种子字节（重定向到 file.onejav.com）时，最终地址即直链', async () => {
    mocks.request.mockResolvedValue(
      gmPage({
        responseText: TORRENT_BODY,
        responseHeaders:
          'server: cloudflare\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC\r\ncontent-type: application/x-bittorrent',
        finalUrl: FILE_URL
      })
    )

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe(FILE_URL)
  })
})

describe('onejav.com 过 CF · 被拦后交给 miao 代取', () => {
  it('onejav 把代取通道传给了 guard：挑战页 → miao 取回页面并解析出种子地址', async () => {
    mocks.request.mockResolvedValue(gmPage({ status: 403, responseText: CHALLENGE_HTML }))

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe(SEED_URL)

    expect(mocks.pageFetch).toHaveBeenCalledWith(DETAIL_URL)
    expect(mocks.pageFetch).toHaveBeenCalledTimes(1)
    // 代取之后不再自己发请求（GM 改不了 UA，凭证必然不匹配）
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('CF 用 200 返回挑战页时同样算拦截，仍然交给 miao', async () => {
    mocks.request.mockResolvedValue(gmPage({ responseText: CHALLENGE_HTML }))

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe(SEED_URL)

    expect(mocks.pageFetch).toHaveBeenCalledTimes(1)
  })

  it('代取回来的页面没有下载按钮 → null，不误报成拦截', async () => {
    mocks.request.mockResolvedValue(gmPage({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.pageFetch.mockResolvedValue({
      ...PROXIED,
      html: '<html><body>该种子已删除</body></html>'
    })

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBeNull()
  })

  it('代取回来仍是挑战页 → CloudflareBlockedError，文案指到 onejav 与代取仍被拦', async () => {
    mocks.request.mockResolvedValue(gmPage({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.pageFetch.mockResolvedValue({ ...PROXIED, status: 403, html: CHALLENGE_HTML })

    const { resolveOnejavTorrent } = await api()
    const error = await resolveOnejavTorrent(DETAIL).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('onejav 被 Cloudflare 拦截')
    expect((error as Error).message).toContain('miao 代取后仍被拦截')
  })

  it('Turnstile 挑战：miao 是真浏览器，照试一次', async () => {
    mocks.request.mockResolvedValue(gmPage({ status: 403, responseText: TURNSTILE_HTML }))

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe(SEED_URL)

    expect(mocks.pageFetch).toHaveBeenCalledTimes(1)
  })

  it('代取通道不可用 → 收敛成拦截失败，文案带上原因', async () => {
    mocks.request.mockResolvedValue(gmPage({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.pageFetch.mockResolvedValue({ ok: false, reason: '过盾器未启动或地址不可达' })

    const { resolveOnejavTorrent } = await api()
    const error = await resolveOnejavTorrent(DETAIL).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取未通过：过盾器未启动或地址不可达')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
})
