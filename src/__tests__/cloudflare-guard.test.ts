import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlockedError } from '@/common/cloudflare'

const mocks = vi.hoisted(() => ({
  request: vi.fn<(url: string, referer?: string, timeout?: number) => Promise<unknown>>(),
  poolRequest: vi.fn<(site: string, url: string, cookies: unknown[]) => Promise<unknown>>(),
  listCookies: vi.fn<(domain: string) => Promise<unknown[]>>()
}))

vi.mock('@/common/common', () => ({ request: mocks.request }))
vi.mock('@/common/session-pool', () => ({
  SessionPool: { getInstance: () => ({ request: mocks.poolRequest }) }
}))
vi.mock('@/common/flare-solverr', () => ({ listCookies: mocks.listCookies }))

/** 动态导入：保证 mock 生效且模块级状态在用例间通过不同 site 隔离 */
async function guard() {
  return import('@/common/cloudflare-guard')
}

const WARM_HTML = '<html><body><a title="Download .torrent" href="/a.torrent">x</a></body></html>'
const CHALLENGE_HTML = '<html><head><title>Just a moment...</title></head></html>'

function gmResponse(overrides: Record<string, unknown>) {
  return {
    status: 200,
    statusText: 'OK',
    responseHeaders: 'server: cloudflare\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC',
    responseText: WARM_HTML,
    finalUrl: 'https://onejav.com/torrent/abc',
    ...overrides
  }
}

function solution(overrides: Record<string, unknown> = {}) {
  return {
    solution: {
      url: 'https://onejav.com/torrent/abc',
      status: 200,
      headers: { server: 'cloudflare' },
      cookies: { cf_clearance: 'clearance-token' },
      userAgent: 'ua',
      response: WARM_HTML,
      ...overrides
    },
    sessionId: 'sid'
  }
}

beforeEach(() => {
  mocks.request.mockReset()
  mocks.poolRequest.mockReset()
  mocks.listCookies.mockReset().mockResolvedValue([])
})

describe('fetchPageThroughCloudflare · 直取', () => {
  it('未命中拦截时返回 HTML 且不启动兜底', async () => {
    mocks.request.mockResolvedValue(gmResponse({}))

    const page = await (await guard()).fetchPageThroughCloudflare({
      site: 'site-direct',
      url: 'https://onejav.com/torrent/abc',
      cookieDomain: 'onejav.com'
    })

    expect(page.via).toBe('direct')
    expect(page.html).toBe(WARM_HTML)
    expect(mocks.poolRequest).not.toHaveBeenCalled()
  })
})

describe('fetchPageThroughCloudflare · 命中拦截', () => {
  it('挑战页命中后改走兜底，并在同一会话内固定走兜底', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.poolRequest.mockResolvedValue(solution())

    const { fetchPageThroughCloudflare } = await guard()
    const first = await fetchPageThroughCloudflare({
      site: 'site-bypass',
      url: 'https://onejav.com/torrent/abc',
      cookieDomain: 'onejav.com'
    })
    expect(first.via).toBe('fallback')
    expect(first.html).toBe(WARM_HTML)

    const second = await fetchPageThroughCloudflare({
      site: 'site-bypass',
      url: 'https://onejav.com/torrent/def',
      cookieDomain: 'onejav.com'
    })
    expect(second.via).toBe('fallback')
    // 第二次不再先撞墙
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.poolRequest).toHaveBeenCalledTimes(2)
  })

  it('兜底抛错时抛 CloudflareBlockedError，文案带上底层原因', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.poolRequest.mockRejectedValue(new Error('请求超时（65000ms）'))

    const { fetchPageThroughCloudflare } = await guard()
    const error = await fetchPageThroughCloudflare({
      site: 'site-timeout',
      url: 'https://onejav.com/torrent/abc',
      cookieDomain: 'onejav.com'
    }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('onejav.com 被 Cloudflare 拦截')
    expect((error as Error).message).toContain('FlareSolverr 兜底未成功：请求超时')
  })

  it('兜底返回的仍是拦截页时抛 CloudflareBlockedError', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.poolRequest.mockResolvedValue(solution({ status: 403, response: CHALLENGE_HTML }))

    const { fetchPageThroughCloudflare } = await guard()
    await expect(
      fetchPageThroughCloudflare({
        site: 'site-still-blocked',
        url: 'https://onejav.com/torrent/abc',
        cookieDomain: 'onejav.com'
      })
    ).rejects.toThrow('FlareSolverr 兜底仍返回拦截页')
  })
})

describe('ensureClearance', () => {
  it('兜底通过后缓存 cf_clearance，并可供二进制链路取用', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.poolRequest.mockResolvedValue(solution())

    const { ensureClearance, getClearanceCookieHeader } = await guard()
    const clearance = await ensureClearance({
      site: 'site-clearance',
      url: 'https://onejav.com/torrent/abc/download/1/a.torrent',
      cookieDomain: 'onejav.com'
    })

    expect(clearance.cookieHeader).toBe('cf_clearance=clearance-token')
    expect(getClearanceCookieHeader('site-clearance')).toBe('cf_clearance=clearance-token')
  })

  it('兜底失败时返回原因，不抛错（由调用方决定文案）', async () => {
    mocks.request.mockResolvedValue(gmResponse({ status: 403, responseText: CHALLENGE_HTML }))
    mocks.poolRequest.mockRejectedValue(new Error('ECONNREFUSED'))

    const { ensureClearance, getClearanceCookieHeader } = await guard()
    const clearance = await ensureClearance({
      site: 'site-clearance-fail',
      url: 'https://onejav.com/torrent/abc/download/1/a.torrent',
      cookieDomain: 'onejav.com'
    })

    expect(clearance.cookieHeader).toBeUndefined()
    expect(clearance.reason).toContain('ECONNREFUSED')
    expect(getClearanceCookieHeader('site-clearance-fail')).toBeUndefined()
  })
})
