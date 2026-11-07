// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlockedError } from '@/common/cloudflare'
import type { PageFetchProvider, PageFetchResult, ProxyResult } from '@/common/miao-proxy.ts'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string, referer?: string, timeout?: number) => Promise<unknown>>()
}))

vi.mock('@/common/common', () => ({ request: mocks.request }))

const WARM_HTML = '<html><body><a title="Download .torrent" href="/a.torrent">x</a></body></html>'
const CHALLENGE_HTML = '<html><head><title>Just a moment...</title></head></html>'
const TURNSTILE_HTML = `<html><body><div class="cf-turnstile"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`

function gmResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    statusText: 'OK',
    responseHeaders: 'server: cloudflare\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC\r\ncontent-type: text/html',
    responseText: WARM_HTML,
    finalUrl: 'https://onejav.com/torrent/abc',
    ...overrides
  }
}

async function guard() {
  return import('@/common/cloudflare-guard')
}

/** 假代取通道：默认回一页正常 HTML */
const GRANTED: ProxyResult<PageFetchResult> = {
  ok: true,
  url: 'https://onejav.com/torrent/abc',
  status: 200,
  html: WARM_HTML,
  contentType: 'text/html; charset=utf-8'
}

function pageFetchProvider(result: ProxyResult<PageFetchResult> = GRANTED) {
  return vi.fn<PageFetchProvider>(async () => result)
}

const PAGE_FETCH = pageFetchProvider()

beforeEach(() => {
  mocks.request.mockReset()
  PAGE_FETCH.mockClear()
  PAGE_FETCH.mockImplementation(async () => GRANTED)
})

describe('fetchPageThroughCloudflare', () => {
  it('未命中拦截时返回 HTML 与响应头，不再做任何兜底请求', async () => {
    mocks.request.mockResolvedValue(gmResponse())

    const page = await (await guard()).fetchPageThroughCloudflare({
      site: 'onejav',
      url: 'https://onejav.com/torrent/abc',
      cookieDomain: 'onejav.com'
    })

    expect(page.html).toBe(WARM_HTML)
    expect(page.url).toBe('https://onejav.com/torrent/abc')
    expect(page.headers['content-type']).toBe('text/html')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(PAGE_FETCH).not.toHaveBeenCalled()
  })

  it('403 挑战页 → CloudflareBlockedError，文案带形态、Ray 与去向', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))

    const error = await (await guard())
      .fetchPageThroughCloudflare({
        site: 'onejav',
        siteLabel: 'onejav',
        url: 'https://onejav.com/torrent/abc',
        cookieDomain: 'onejav.com'
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('onejav 被 Cloudflare 拦截')
    expect((error as Error).message).toContain('Ray 8f2a1c3b4d5e6f70')
    expect((error as Error).message).toContain('脚本请求无法通过该站点验证')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('给了代取通道：命中拦截后交给 miao，用它返回的 HTML 继续解析', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))

    const page = await (await guard()).fetchPageThroughCloudflare({
      site: 'onejav',
      url: 'https://onejav.com/torrent/abc',
      cookieDomain: 'onejav.com',
      pageFetch: PAGE_FETCH
    })

    expect(page.html).toBe(WARM_HTML)
    expect(page.url).toBe('https://onejav.com/torrent/abc')
    expect(page.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(PAGE_FETCH).toHaveBeenCalledWith('https://onejav.com/torrent/abc')
    // 关键：代取之后不再自己发第二次 GM 请求（GM 改不了 UA，凭证必然不匹配）
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('代取回来仍是挑战页 → 抛错，文案说明重取仍被拦', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    PAGE_FETCH.mockResolvedValue({ ...GRANTED, status: 403, html: CHALLENGE_HTML })

    const error = await (await guard())
      .fetchPageThroughCloudflare({
        site: 'onejav',
        url: 'https://onejav.com/torrent/abc',
        cookieDomain: 'onejav.com',
        pageFetch: PAGE_FETCH
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取后仍被拦截')
    expect(PAGE_FETCH).toHaveBeenCalledTimes(1)
  })

  it('代取没成 → 直接抛错，文案带上服务端给的原因', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    PAGE_FETCH.mockResolvedValue({ ok: false, reason: '该站点不在 miao 的站点白名单内' })

    const error = await (await guard())
      .fetchPageThroughCloudflare({
        site: 'onejav',
        url: 'https://onejav.com/torrent/abc',
        cookieDomain: 'onejav.com',
        pageFetch: PAGE_FETCH
      })
      .catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取未通过：该站点不在 miao 的站点白名单内')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('Turnstile 挑战：交给自己发请求的 miao（真浏览器），不再本地跳过', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: TURNSTILE_HTML }))

    const page = await (await guard()).fetchPageThroughCloudflare({
      site: 'onejav',
      url: 'https://onejav.com/torrent/abc',
      cookieDomain: 'onejav.com',
      pageFetch: PAGE_FETCH
    })

    expect(page.html).toBe(WARM_HTML)
    expect(PAGE_FETCH).toHaveBeenCalledTimes(1)
  })

  it('状态码 200 的挑战页同样算拦截（CF 会用 200 返回挑战页）', async () => {
    mocks.request.mockResolvedValue(gmResponse({ responseText: CHALLENGE_HTML }))

    await expect(
      (await guard()).fetchPageThroughCloudflare({
        site: 'onejav',
        url: 'https://onejav.com/torrent/abc',
        cookieDomain: 'onejav.com'
      })
    ).rejects.toThrow('Cloudflare 拦截')
  })
})
