// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import jquery from 'jquery'
import { highScoreMagnet } from '@/site/javdb/javdb-api'
import { resolveJavdbMagnet } from '@/site/onejav/onejav'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_addStyle: vi.fn<(css: string) => void>(),
  GM_cookie: { list: vi.fn<(details: unknown, cb: unknown) => void>() },
  monkeyWindow: {}
}))
vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))
vi.mock('@/site/javdb/javdb-api', () => ({
  highScoreMagnet: vi.fn<(serialNumber: string) => Promise<JQuery<HTMLElement> | undefined>>()
}))

const HIGH_SCORE_MOCK = vi.mocked(highScoreMagnet)

function magnetLink(href?: string): JQuery<HTMLElement> {
  const anchor = href ? `<a href="${href}">x</a>` : '<a>x</a>'
  return jquery(anchor) as unknown as JQuery<HTMLElement>
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('onejav · javdb 高分磁力解析', () => {
  it('命中：返回磁链且不带未命中原因', async () => {
    HIGH_SCORE_MOCK.mockResolvedValue(magnetLink('magnet:?xt=urn:btih:abc'))

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({ magnet: 'magnet:?xt=urn:btih:abc' })
    expect(HIGH_SCORE_MOCK).toHaveBeenCalledWith('ABC-123')
  })

  it('javdb 以字符串 reject（没有高分磁力）→ 原因透传给通知', async () => {
    HIGH_SCORE_MOCK.mockRejectedValue('没有找到高分磁力链接')

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: null,
      reason: '没有找到高分磁力链接'
    })
  })

  it('javdb 抛 Error → 取 message 作为原因', async () => {
    HIGH_SCORE_MOCK.mockRejectedValue(new Error('IP被ban了'))

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({ magnet: null, reason: 'IP被ban了' })
  })

  it('FC2：不请求 javdb，直接给出跳过原因', async () => {
    HIGH_SCORE_MOCK.mockResolvedValue(magnetLink('magnet:?xt=urn:btih:abc'))

    await expect(resolveJavdbMagnet('FC2PPV123')).resolves.toEqual({
      magnet: null,
      reason: 'FC2 不受 javdb 支持'
    })
    expect(HIGH_SCORE_MOCK).not.toHaveBeenCalled()
  })

  it('javdb 元素没有 href → 视为未命中', async () => {
    HIGH_SCORE_MOCK.mockResolvedValue(magnetLink())

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: null,
      reason: 'javdb 没有返回磁力链接'
    })
  })
})
