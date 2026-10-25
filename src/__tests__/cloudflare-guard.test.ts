// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlockedError } from '@/common/cloudflare'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string, referer?: string, timeout?: number) => Promise<unknown>>()
}))

vi.mock('@/common/common', () => ({ request: mocks.request }))

const WARM_HTML = '<html><body><a title="Download .torrent" href="/a.torrent">x</a></body></html>'
const CHALLENGE_HTML = '<html><head><title>Just a moment...</title></head></html>'

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

beforeEach(() => {
  mocks.request.mockReset()
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
    expect((error as Error).message).toContain('已改为交给浏览器')
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
