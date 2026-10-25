// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareBlockedError } from '@/common/cloudflare'

const mocks = vi.hoisted(() => ({
  fetchPage: vi.fn<(input: unknown) => Promise<unknown>>(),
  handoff: vi.fn<(url: string) => 'tab' | 'same-tab'>()
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
vi.mock('@/common/cloudflare-guard', () => ({ fetchPageThroughCloudflare: mocks.fetchPage }))
vi.mock('@/download/browser', () => ({ handoffToBrowser: mocks.handoff }))

const DETAIL = '/torrent/abf274/download/94029137/onejav.com_abf274.torrent'
const TORRENT_URL = 'https://onejav.com' + DETAIL

const DOWNLOAD_HTML = `<html><body><div class="card"><a title="Download .torrent" href="${DETAIL}">Download</a></div></body></html>`

interface PageOverrides {
  url?: string
  status?: number
  html?: string
  headers?: Record<string, string>
}

function page(overrides: PageOverrides = {}) {
  return {
    url: TORRENT_URL,
    status: 200,
    html: DOWNLOAD_HTML,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...overrides
  }
}

function challengeError() {
  return new CloudflareBlockedError(
    'onejav',
    { kind: 'challenge', status: 403, rayId: '8f2a1c3b', evidence: '页面特征 just a moment' },
    '脚本请求无法通过该站点验证，已改为交给浏览器'
  )
}

async function api() {
  return import('@/site/onejav/onejav-api')
}

beforeEach(() => {
  mocks.fetchPage.mockReset()
  mocks.handoff.mockReset().mockReturnValue('tab')
})

describe('resolveOnejavTorrent', () => {
  it('详情页 HTML 命中下载按钮时拼出种子地址', async () => {
    mocks.fetchPage.mockResolvedValue(page())

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe(TORRENT_URL)
  })

  it('响应本身就是种子二进制时把最终地址当直链', async () => {
    mocks.fetchPage.mockResolvedValue(
      page({
        url: 'https://file.onejav.com/torrent/abf274.torrent',
        html: 'd8:announce30:http://tracker.example/announce4:infod4:name8:abf274e',
        headers: { 'content-type': 'application/x-bittorrent' }
      })
    )

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBe('https://file.onejav.com/torrent/abf274.torrent')
  })

  it('页面正常但没有下载按钮时返回 null（不误报成拦截）', async () => {
    mocks.fetchPage.mockResolvedValue(page({ html: '<html><body>没有种子</body></html>' }))

    const { resolveOnejavTorrent } = await api()
    await expect(resolveOnejavTorrent(DETAIL)).resolves.toBeNull()
  })
})

describe('resolveOnejavSeed · 命中拦截交给浏览器', () => {
  it('被 Cloudflare 拦下 → 把绝对种子地址交给浏览器，并标记 handoff', async () => {
    mocks.fetchPage.mockRejectedValue(challengeError())

    const { resolveOnejavSeed } = await api()
    await expect(resolveOnejavSeed(DETAIL)).resolves.toEqual({ url: TORRENT_URL, handoff: 'browser' })
    expect(mocks.handoff).toHaveBeenCalledWith(TORRENT_URL)
  })

  it('绝对地址原样使用，不重复拼站点前缀', async () => {
    mocks.fetchPage.mockRejectedValue(challengeError())

    const { resolveOnejavSeed } = await api()
    await expect(resolveOnejavSeed(TORRENT_URL)).resolves.toMatchObject({ url: TORRENT_URL })
  })

  it('正常解析时不触发浏览器接管', async () => {
    mocks.fetchPage.mockResolvedValue(page())

    const { resolveOnejavSeed } = await api()
    await expect(resolveOnejavSeed(DETAIL)).resolves.toEqual({ url: TORRENT_URL })
    expect(mocks.handoff).not.toHaveBeenCalled()
  })

  it('非 Cloudflare 的异常原样抛出（不吞成 handoff）', async () => {
    mocks.fetchPage.mockRejectedValue(new Error('请求超时'))

    const { resolveOnejavSeed } = await api()
    await expect(resolveOnejavSeed(DETAIL)).rejects.toThrow('请求超时')
    expect(mocks.handoff).not.toHaveBeenCalled()
  })
})
