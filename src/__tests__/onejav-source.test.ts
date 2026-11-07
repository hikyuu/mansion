// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import jquery from 'jquery'
import { pickJavdbMagnet } from '@/site/javdb/javdb-api'
import { resolveOnejavTorrent } from '@/site/onejav/onejav-api'
import { CloudflareBlockedError } from '@/common/cloudflare'
import { resolveJavdbMagnet, resolveOnejavSource } from '@/site/onejav/onejav'

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
  pickJavdbMagnet:
    vi.fn<(serialNumber: string) => Promise<{ magnet: JQuery<HTMLElement>; score: number }>>()
}))
vi.mock('@/site/onejav/onejav-api', () => ({
  resolveOnejavTorrent: vi.fn<(detailUrl: string) => Promise<string | null>>()
}))

const PICK_MOCK = vi.mocked(pickJavdbMagnet)
const TORRENT_MOCK = vi.mocked(resolveOnejavTorrent)

const DETAIL = '/torrent/abf274/download/94029137/onejav.com_abf274.torrent'
const SEED_URL = 'https://onejav.com' + DETAIL
const HIGH_SCORE = 'magnet:?xt=urn:btih:highscore'
const ANY = 'magnet:?xt=urn:btih:any'

function magnetLink(href?: string): JQuery<HTMLElement> {
  const anchor = href ? `<a href="${href}">x</a>` : '<a>x</a>'
  return jquery(anchor) as unknown as JQuery<HTMLElement>
}

/** javdb 详情页解析结果：分数 > 0 才算高分 */
function choice(href: string | undefined, score: number) {
  return { magnet: magnetLink(href), score }
}

function challengeError() {
  return new CloudflareBlockedError('onejav', {
    kind: 'challenge',
    status: 403,
    rayId: '8f2a1c3b',
    evidence: '页面特征 just a moment'
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('resolveJavdbMagnet · 一次请求同时给出高分与非高分', () => {
  it('高分：磁力同时作为高分与兜底候选', async () => {
    PICK_MOCK.mockResolvedValue(choice(HIGH_SCORE, 1))

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: HIGH_SCORE,
      fallbackMagnet: HIGH_SCORE
    })
    expect(PICK_MOCK).toHaveBeenCalledWith('ABC-123')
  })

  it('分数为 0：高分未命中，但把这条留给 Cloudflare 兜底用', async () => {
    PICK_MOCK.mockResolvedValue(choice(ANY, 0))

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: null,
      fallbackMagnet: ANY,
      reason: '没有找到高分磁力链接'
    })
  })

  it('javdb 以字符串 reject → 原因透传给通知，无兜底候选', async () => {
    PICK_MOCK.mockRejectedValue('没有找到磁力链接')

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: null,
      fallbackMagnet: null,
      reason: '没有找到磁力链接'
    })
  })

  it('javdb 抛 Error → 取 message 作为原因', async () => {
    PICK_MOCK.mockRejectedValue(new Error('IP被ban了'))

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: null,
      fallbackMagnet: null,
      reason: 'IP被ban了'
    })
  })

  it('FC2：不请求 javdb，直接给出跳过原因', async () => {
    PICK_MOCK.mockResolvedValue(choice(HIGH_SCORE, 1))

    await expect(resolveJavdbMagnet('FC2PPV123')).resolves.toEqual({
      magnet: null,
      fallbackMagnet: null,
      reason: 'FC2 不受 javdb 支持'
    })
    expect(PICK_MOCK).not.toHaveBeenCalled()
  })

  it('磁力元素没有 href → 视为未命中且无兜底候选', async () => {
    PICK_MOCK.mockResolvedValue(choice(undefined, 0))

    await expect(resolveJavdbMagnet('ABC-123')).resolves.toEqual({
      magnet: null,
      fallbackMagnet: null,
      reason: 'javdb 没有返回磁力链接'
    })
  })
})

describe('resolveOnejavSource · 三级降级', () => {
  it('javdb 高分命中 → 直接交付，不碰 onejav 种子', async () => {
    PICK_MOCK.mockResolvedValue(choice(HIGH_SCORE, 1))

    await expect(resolveOnejavSource('ABC-123', DETAIL)).resolves.toEqual({
      url: HIGH_SCORE,
      source: { label: 'javdb 高分磁力', origin: 'javdb' }
    })
    expect(TORRENT_MOCK).not.toHaveBeenCalled()
  })

  it('高分未命中、onejav 种子能直接拿到 → onejav 种子，未命中原因进备注，并挂上备用磁力', async () => {
    PICK_MOCK.mockResolvedValue(choice(ANY, 0))
    TORRENT_MOCK.mockResolvedValue(SEED_URL)

    await expect(resolveOnejavSource('ABC-123', DETAIL)).resolves.toEqual({
      url: SEED_URL,
      source: {
        label: 'onejav 种子',
        note: 'javdb 未命中：没有找到高分磁力链接',
        origin: 'onejav'
      },
      // 种子字节可能在交付阶段才被拦，备用地址提前挂上，届时不必再请求 javdb
      fallback: {
        url: ANY,
        source: { label: 'javdb 磁力', note: 'onejav 种子被 Cloudflare 拦截', origin: 'javdb' }
      }
    })
  })

  it('javdb 连磁力都没解析到 → onejav 种子照用，但不再挂备用地址', async () => {
    PICK_MOCK.mockRejectedValue('没有找到磁力链接')
    TORRENT_MOCK.mockResolvedValue(SEED_URL)

    const resolved = await resolveOnejavSource('ABC-123', DETAIL)

    expect(resolved.url).toBe(SEED_URL)
    expect(resolved.fallback).toBeUndefined()
  })

  it('种子链接被 Cloudflare 拦下 → 复用 javdb 已解析的磁力，不再请求 javdb', async () => {
    PICK_MOCK.mockResolvedValue(choice(ANY, 0))
    TORRENT_MOCK.mockRejectedValue(challengeError())

    await expect(resolveOnejavSource('ABC-123', DETAIL)).resolves.toEqual({
      url: ANY,
      source: { label: 'javdb 磁力', note: 'onejav 种子被 Cloudflare 拦截', origin: 'javdb' }
    })
    expect(PICK_MOCK).toHaveBeenCalledTimes(1)
    expect(TORRENT_MOCK).toHaveBeenCalledTimes(1)
  })

  it('javdb 解析就失败 + Cloudflare 拦截 → 抛错带出原因，不重试任何一级', async () => {
    PICK_MOCK.mockRejectedValue('没有找到磁力链接')
    TORRENT_MOCK.mockRejectedValue(challengeError())

    await expect(resolveOnejavSource('ABC-123', DETAIL)).rejects.toThrow(
      'onejav 种子被 Cloudflare 拦截，javdb 回退未命中：没有找到磁力链接'
    )
    expect(PICK_MOCK).toHaveBeenCalledTimes(1)
    expect(TORRENT_MOCK).toHaveBeenCalledTimes(1)
  })

  it('非 Cloudflare 异常原样抛出，不触发 javdb 兜底', async () => {
    PICK_MOCK.mockResolvedValue(choice(ANY, 0))
    TORRENT_MOCK.mockRejectedValue(new Error('请求超时'))

    await expect(resolveOnejavSource('ABC-123', DETAIL)).rejects.toThrow('请求超时')
  })

  it('详情页没有下载按钮 → 抛错并带出 javdb 未命中原因', async () => {
    PICK_MOCK.mockResolvedValue(choice(ANY, 0))

    await expect(resolveOnejavSource('ABC-123', undefined)).rejects.toThrow(
      'onejav 详情页没有下载按钮（javdb 未命中：没有找到高分磁力链接）'
    )
  })
})
