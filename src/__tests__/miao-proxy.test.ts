// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThunderApiError, ThunderTransportError } from '@hikyuu/miao'
import { describeProxyError, miaoBrowserDownload, miaoPageFetch } from '@/download/miao-proxy.ts'
import { useConfigStore } from '@/store/config-store.ts'

/**
 * miao 代理通道：只关心「怎么调 miao、失败怎么说、失败后怎么清场」。
 * SDK 与服务地址都换成替身，真正的链路（guard / torrent）在各自的测试里验。
 */

const web = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, options?: unknown) => Promise<unknown>>(),
  download: vi.fn<(url: string, options?: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<(origin: string, options?: unknown) => Promise<void>>()
}))

vi.mock('@/download/miao-client.ts', () => ({
  createMiaoClient: () => ({
    web: { fetch: web.fetch, download: web.download, invalidate: web.invalidate }
  })
}))
vi.mock('@/store/config-store.ts', () => ({ useConfigStore: vi.fn<() => unknown>() }))

const BASE_URL = 'http://127.0.0.1:6427'

function fetched(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://onejav.com/torrent/abc',
    status: 200,
    html: '<html><body>ok</body></html>',
    contentType: 'text/html; charset=utf-8',
    userAgent: 'miao-ua',
    cookies: null,
    solved: false,
    cached: true,
    elapsedMs: 42,
    ...overrides
  }
}

function downloaded(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://file.onejav.com/a.torrent',
    status: 200,
    contentType: 'application/x-bittorrent',
    size: 5,
    base64: 'ZDM6YW5u',
    userAgent: 'miao-ua',
    cached: true,
    elapsedMs: 12,
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(useConfigStore).mockReturnValue({
    common: { miao: { savePath: 'L:\\Downloads', baseUrl: BASE_URL } }
  } as unknown as ReturnType<typeof useConfigStore>)
  web.fetch.mockReset()
  web.download.mockReset()
  web.invalidate.mockReset()
  web.invalidate.mockResolvedValue(undefined)
})

describe('miaoPageFetch', () => {
  it('成功：调 web.fetch，回 HTML 与状态', async () => {
    web.fetch.mockResolvedValue(fetched())

    const result = await miaoPageFetch('https://onejav.com/torrent/abc')

    expect(result).toEqual({
      ok: true,
      url: 'https://onejav.com/torrent/abc',
      status: 200,
      html: '<html><body>ok</body></html>',
      contentType: 'text/html; charset=utf-8'
    })
    expect(web.fetch).toHaveBeenCalledWith('https://onejav.com/torrent/abc', { timeoutMs: 150_000 })
  })

  it('挑战失败：销毁该 origin 的会话，且下一次请求不再被挡住', async () => {
    web.fetch
      .mockRejectedValueOnce(new ThunderApiError(502, 'CHALLENGE_FAILED', 'challenge'))
      .mockResolvedValueOnce(fetched())

    const first = await miaoPageFetch('https://onejav.com/a')
    expect(first).toEqual({ ok: false, reason: '过盾失败（拿回的仍是挑战页）' })
    expect(web.invalidate).toHaveBeenCalledWith('https://onejav.com', { timeoutMs: 5_000 })

    const second = await miaoPageFetch('https://onejav.com/b')
    expect(second.ok).toBe(true)
    expect(web.fetch).toHaveBeenCalledTimes(2)
  })

  it('过盾超时同样销毁会话', async () => {
    web.fetch.mockRejectedValue(new ThunderApiError(504, 'CHALLENGE_TIMEOUT', 'timeout'))

    const result = await miaoPageFetch('https://onejav.com/a')

    expect(result).toEqual({ ok: false, reason: '过盾超时' })
    expect(web.invalidate).toHaveBeenCalledWith('https://onejav.com', { timeoutMs: 5_000 })
  })

  it('代取回来仍是挑战页：结果原样回传，但销毁会话', async () => {
    web.fetch.mockResolvedValue(
      fetched({ status: 403, html: '<html><head><title>Just a moment...</title></head></html>' })
    )

    const result = await miaoPageFetch('https://onejav.com/torrent/a')

    expect(result.ok).toBe(true)
    expect(web.invalidate).toHaveBeenCalledWith('https://onejav.com', { timeoutMs: 5_000 })
  })

  it('配置类错误不销毁会话：改完白名单就能立刻重试', async () => {
    web.fetch
      .mockRejectedValueOnce(new ThunderApiError(403, 'WEB_HOST_NOT_ALLOWED', 'no'))
      .mockResolvedValueOnce(fetched())

    const first = await miaoPageFetch('https://onejav.com/a')
    expect(first).toEqual({ ok: false, reason: '该站点不在 miao 的站点白名单内' })
    expect(web.invalidate).not.toHaveBeenCalled()

    const second = await miaoPageFetch('https://onejav.com/a')
    expect(second.ok).toBe(true)
    expect(web.fetch).toHaveBeenCalledTimes(2)
  })

  it('miao 连不上：判为通道不可用，不销毁会话', async () => {
    web.fetch.mockRejectedValue(new ThunderTransportError('connect ECONNREFUSED'))

    const result = await miaoPageFetch('https://onejav.com/a')

    expect(result).toEqual({ ok: false, reason: '无法连接 miao（未启动或未开启 REST 接口）' })
    expect(web.invalidate).not.toHaveBeenCalled()
  })
})

describe('miaoBrowserDownload · auto 模式', () => {
  it('成功：调 web.download，让服务端自己选 http / browser', async () => {
    web.download.mockResolvedValue(downloaded())

    const result = await miaoBrowserDownload('https://file.onejav.com/a.torrent')

    expect(result).toMatchObject({ ok: true, size: 5, base64: 'ZDM6YW5u', status: 200 })
    // auto：先纯 HTTP，撞挑战由服务端降级到浏览器下载栈
    expect(web.download).toHaveBeenCalledWith('https://file.onejav.com/a.torrent', {
      mode: 'auto',
      maxBytes: 5 * 1024 * 1024,
      timeoutMs: 150_000
    })
  })

  it('文件超过上限：给出可读原因', async () => {
    web.download.mockRejectedValue(new ThunderApiError(502, 'WEB_RESPONSE_TOO_LARGE', 'too large'))

    const result = await miaoBrowserDownload('https://file.onejav.com/a.torrent')

    expect(result).toEqual({ ok: false, reason: '目标文件超过 miao 的响应体上限' })
  })

  it('挑战失败：字节通道同样销毁会话，且下一次请求不再被挡住', async () => {
    web.download
      .mockRejectedValueOnce(new ThunderApiError(502, 'CHALLENGE_FAILED', 'x'))
      .mockResolvedValueOnce(downloaded())

    const first = await miaoBrowserDownload('https://file.onejav.com/a.torrent')
    expect(first).toEqual({ ok: false, reason: '过盾失败（拿回的仍是挑战页）' })
    expect(web.invalidate).toHaveBeenCalledWith('https://file.onejav.com', { timeoutMs: 5_000 })

    const second = await miaoBrowserDownload('https://file.onejav.com/b.torrent')
    expect(second.ok).toBe(true)
    expect(web.download).toHaveBeenCalledTimes(2)
  })
})

describe('describeProxyError', () => {
  it('过盾器相关的错误码各自给一句可操作的提示', () => {
    expect(describeProxyError(new ThunderApiError(502, 'SOLVER_UNAVAILABLE', 'x'))).toBe(
      '过盾器未启动或地址不可达'
    )
    expect(describeProxyError(new ThunderApiError(503, 'SOLVER_CHROME_MISSING', 'x'))).toContain('Chrome')
    expect(describeProxyError(new ThunderApiError(403, 'WEB_DISABLED', 'x'))).toContain('web 能力')
    expect(describeProxyError(new ThunderApiError(401, 'UNAUTHORIZED', 'x'))).toContain('token')
    expect(describeProxyError(new ThunderApiError(403, 'COOKIE_EXPORT_DISABLED', 'x'))).toContain('凭证导出')
  })

  it('fake-ip 被拒时给出可操作的提示，而不是只回 reason 原文', () => {
    expect(
      describeProxyError(new ThunderApiError(400, 'WEB_URL_INVALID', 'x', undefined, 'fake_ip'))
    ).toContain('信任代理 fake-ip')
    expect(
      describeProxyError(new ThunderApiError(400, 'WEB_URL_INVALID', 'x', undefined, 'scheme'))
    ).toBe('目标地址不被 miao 接受（scheme）')
  })

  it('未知错误退回原始消息', () => {
    expect(describeProxyError(new Error('boom'))).toBe('boom')
    expect(describeProxyError('str')).toBe('str')
  })
})
