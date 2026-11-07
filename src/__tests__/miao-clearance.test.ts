// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThunderApiError, ThunderTransportError } from '@hikyuu/miao'
import { describeClearanceError, miaoClearance } from '@/download/miao-clearance.ts'
import { useConfigStore } from '@/store/config-store.ts'

/**
 * miao 过盾通道：只关心「怎么调 miao、失败怎么说、失败后怎么清场」。
 * SDK 与服务地址都换成替身，真正的链路（guard / torrent）在各自的测试里验。
 */

const web = vi.hoisted(() => ({
  clearance: vi.fn<(origin: string, options?: unknown) => Promise<unknown>>(),
  invalidate: vi.fn<(origin: string, options?: unknown) => Promise<void>>()
}))

vi.mock('@/download/miao-client.ts', () => ({
  createMiaoClient: () => ({ web: { clearance: web.clearance, invalidate: web.invalidate } })
}))
vi.mock('@/store/config-store.ts', () => ({ useConfigStore: vi.fn<() => unknown>() }))

const BASE_URL = 'http://127.0.0.1:6427'

function clearance(overrides: Record<string, unknown> = {}) {
  return {
    origin: 'https://onejav.com',
    cookies: [{ name: 'cf_clearance', value: 'abc', domain: 'onejav.com', path: '/' }],
    cookieHeader: 'cf_clearance=abc',
    userAgent: 'miao-ua',
    obtainedAt: 1,
    expiresAt: 2,
    cached: false,
    solved: true,
    elapsedMs: 1200,
    ...overrides
  }
}

beforeEach(() => {
  vi.mocked(useConfigStore).mockReturnValue({
    common: { miao: { savePath: 'L:\\Downloads', baseUrl: BASE_URL } }
  } as unknown as ReturnType<typeof useConfigStore>)
  web.clearance.mockReset()
  web.invalidate.mockReset()
  web.invalidate.mockResolvedValue(undefined)
})

describe('miaoClearance', () => {
  it('成功：按 origin 取凭证，返回 cookie + UA 一对', async () => {
    web.clearance.mockResolvedValue(clearance())

    const result = await miaoClearance('https://onejav.com/torrent/a.torrent?a=1')

    expect(result).toEqual({ ok: true, ticket: { cookie: 'cf_clearance=abc', userAgent: 'miao-ua' } })
    // 过盾器按 origin 缓存：路径与查询串不参与
    expect(web.clearance).toHaveBeenCalledWith('https://onejav.com', { timeoutMs: 150_000 })
  })

  it('挑战失败：销毁会话，且下一次请求不再被挡住', async () => {
    web.clearance
      .mockRejectedValueOnce(new ThunderApiError(502, 'CHALLENGE_FAILED', 'challenge'))
      .mockResolvedValueOnce(clearance())

    const first = await miaoClearance('https://onejav.com/a')
    expect(first).toEqual({ ok: false, reason: '过盾失败（拿回的仍是挑战页）' })
    expect(web.invalidate).toHaveBeenCalledWith('https://onejav.com', { timeoutMs: 5_000 })

    const second = await miaoClearance('https://onejav.com/b')
    expect(second.ok).toBe(true)
    expect(web.clearance).toHaveBeenCalledTimes(2)
  })

  it('配置类错误不销毁会话：改完白名单就能立刻重试', async () => {
    web.clearance
      .mockRejectedValueOnce(new ThunderApiError(403, 'WEB_HOST_NOT_ALLOWED', 'no'))
      .mockResolvedValueOnce(clearance())

    const first = await miaoClearance('https://onejav.com/a')
    expect(first).toEqual({ ok: false, reason: '该站点不在 miao 的站点白名单内' })
    expect(web.invalidate).not.toHaveBeenCalled()

    const second = await miaoClearance('https://onejav.com/a')
    expect(second.ok).toBe(true)
    expect(web.clearance).toHaveBeenCalledTimes(2)
  })

  it('miao 连不上：判为通道不可用，不销毁会话', async () => {
    web.clearance.mockRejectedValue(new ThunderTransportError('connect ECONNREFUSED'))

    const result = await miaoClearance('https://onejav.com/a')

    expect(result).toEqual({ ok: false, reason: '无法连接 miao（未启动或未开启 REST 接口）' })
    expect(web.invalidate).not.toHaveBeenCalled()
  })

  it('服务端没回传 cookie（导出被关）：拿不到凭证就没有重取的意义', async () => {
    web.clearance.mockResolvedValue(clearance({ cookieHeader: '' }))

    const result = await miaoClearance('https://onejav.com/a')

    expect(result).toEqual({ ok: false, reason: 'miao 没有回传可用的过盾凭证' })
  })
})

describe('describeClearanceError', () => {
  it('过盾器相关的错误码各自给一句可操作的提示', () => {
    expect(describeClearanceError(new ThunderApiError(502, 'SOLVER_UNAVAILABLE', 'x'))).toBe(
      '过盾器未启动或地址不可达'
    )
    expect(describeClearanceError(new ThunderApiError(503, 'SOLVER_CHROME_MISSING', 'x'))).toContain('Chrome')
    expect(describeClearanceError(new ThunderApiError(403, 'WEB_DISABLED', 'x'))).toContain('web 能力')
    expect(describeClearanceError(new ThunderApiError(401, 'UNAUTHORIZED', 'x'))).toContain('token')
    expect(describeClearanceError(new ThunderApiError(403, 'COOKIE_EXPORT_DISABLED', 'x'))).toContain(
      '凭证导出'
    )
  })

  it('fake-ip 被拒时给出可操作的提示，而不是只回 reason 原文', () => {
    expect(
      describeClearanceError(new ThunderApiError(400, 'WEB_URL_INVALID', 'x', undefined, 'fake_ip'))
    ).toContain('信任代理 fake-ip')
    expect(
      describeClearanceError(new ThunderApiError(400, 'WEB_URL_INVALID', 'x', undefined, 'scheme'))
    ).toBe('目标地址不被 miao 接受（scheme）')
  })

  it('未知错误退回原始消息', () => {
    expect(describeClearanceError(new Error('boom'))).toBe('boom')
    expect(describeClearanceError('str')).toBe('str')
  })
})
