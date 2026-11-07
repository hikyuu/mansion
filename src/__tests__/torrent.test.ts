import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import { fetchTorrentBase64, TorrentFetchError } from '@/download/torrent.ts'
import { CloudflareBlockedError } from '@/common/cloudflare'
import { navigationHeaders } from '@/common/navigation-headers.ts'
import type { BinaryFetchProvider } from '@/common/miao-proxy.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  GM_cookie: { list: vi.fn<(details: unknown, cb: unknown) => void>() },
  monkeyWindow: {}
}))

const gmMock = vi.mocked(GM_xmlhttpRequest)

interface GmDetails {
  url: string
  headers?: Record<string, string>
  onload?: (res: {
    response: ArrayBuffer | string
    status?: number
    responseHeaders?: string
    finalUrl?: string
  }) => void
  onerror?: (err: { error?: string }) => void
  ontimeout?: () => void
}

const URL_TORRENT = 'https://exhentai.org/torrent/1/a.torrent'
const CF_HEADERS = 'server: cloudflare\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC'

function respondWith(buffer: ArrayBuffer | string) {
  gmMock.mockImplementation(((details: GmDetails) => {
    details.onload?.({ response: buffer })
    return { abort: vi.fn<() => void>() }
  }) as unknown as typeof GM_xmlhttpRequest)
}

function respondChallenge(buffer: ArrayBuffer, status = 403, finalUrl = URL_TORRENT) {
  gmMock.mockImplementation(((details: GmDetails) => {
    details.onload?.({ response: buffer, status, responseHeaders: CF_HEADERS, finalUrl })
    return { abort: vi.fn<() => void>() }
  }) as unknown as typeof GM_xmlhttpRequest)
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

function challengePage(): ArrayBuffer {
  return new TextEncoder().encode('<html><head><title>Just a moment...</title></head></html>')
    .buffer as ArrayBuffer
}

beforeEach(() => {
  gmMock.mockReset()
})

describe('fetchTorrentBase64', () => {
  it('合法种子字节 → base64（请求透传 url 与 arraybuffer）', async () => {
    respondWith(bytes(0x64, 0x65)) // bencode 字典开头 'de'
    await expect(fetchTorrentBase64(URL_TORRENT)).resolves.toBe('ZGU=')
    const details = gmMock.mock.calls[0]?.[0] as { url: string; responseType: string }
    expect(details.url).toBe(URL_TORRENT)
    expect(details.responseType).toBe('arraybuffer')
  })

  it('请求按导航形态发（带 Sec-Fetch-*），减少托管挑战误伤', async () => {
    respondWith(bytes(0x64, 0x65))
    await fetchTorrentBase64(URL_TORRENT)
    const details = gmMock.mock.calls[0]?.[0] as { headers?: Record<string, string> }
    expect(details.headers?.['Sec-Fetch-Dest']).toBe('document')
    expect(details.headers?.['Sec-Fetch-Mode']).toBe('navigate')
  })

  it('响应不是 bencode（登录页 / 失效页）→ TorrentFetchError', async () => {
    respondWith(new TextEncoder().encode('<html>login</html>').buffer as ArrayBuffer)
    await expect(fetchTorrentBase64(URL_TORRENT)).rejects.toBeInstanceOf(TorrentFetchError)
    await expect(fetchTorrentBase64(URL_TORRENT)).rejects.toThrow('有效的种子文件')
  })

  it('空内容 → TorrentFetchError', async () => {
    respondWith(new ArrayBuffer(0))
    await expect(fetchTorrentBase64(URL_TORRENT)).rejects.toThrow('空内容')
  })

  it('超过 5MiB 上限 → TorrentFetchError', async () => {
    respondWith(new ArrayBuffer(5 * 1024 * 1024 + 1))
    await expect(fetchTorrentBase64(URL_TORRENT)).rejects.toThrow('5MiB')
  })

  it('网络错误 → TorrentFetchError', async () => {
    gmMock.mockImplementation(((details: GmDetails) => {
      details.onerror?.({ error: 'net::ERR_CONNECTION_RESET' })
      return { abort: vi.fn<() => void>() }
    }) as unknown as typeof GM_xmlhttpRequest)
    await expect(fetchTorrentBase64(URL_TORRENT)).rejects.toThrow('下载种子失败')
  })

  it('超时 → TorrentFetchError', async () => {
    gmMock.mockImplementation(((details: GmDetails) => {
      details.ontimeout?.()
      return { abort: vi.fn<() => void>() }
    }) as unknown as typeof GM_xmlhttpRequest)
    await expect(fetchTorrentBase64(URL_TORRENT)).rejects.toThrow('下载种子超时')
  })
})

const TURNSTILE_HTML = `<html><body><div class="cf-turnstile"></div>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>`

function turnstileOn(details: GmDetails) {
  details.onload?.({
    response: new TextEncoder().encode(TURNSTILE_HTML).buffer as ArrayBuffer,
    status: 403,
    responseHeaders: CF_HEADERS,
    finalUrl: URL_TORRENT
  })
}

/** 假代下载通道：默认回一颗最小种子（base64('de') = 'ZGU='） */
const GRANTED_BINARY = {
  ok: true as const,
  url: 'https://file.onejav.com/a.torrent',
  status: 200,
  contentType: 'application/x-bittorrent',
  size: 2,
  base64: 'ZGU='
}

function binaryProvider(
  result: Awaited<ReturnType<BinaryFetchProvider>> = GRANTED_BINARY
) {
  return vi.fn<BinaryFetchProvider>(async () => result)
}

const PROXY = binaryProvider()

describe('fetchTorrentBase64 · Cloudflare 拦截', () => {
  it('没有代下载通道：命中即抛错，只请求一次', async () => {
    respondChallenge(challengePage())

    const error = await fetchTorrentBase64(URL_TORRENT).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('Cloudflare 拦截')
    expect((error as Error).message).toContain('脚本请求无法通过该站点验证')
    expect(gmMock).toHaveBeenCalledTimes(1)
  })

  it('200 + 挑战页 → 按拦截处理，不报「不是种子」', async () => {
    respondChallenge(
      new TextEncoder().encode('<html><script>window._cf_chl_opt={}</script></html>').buffer as ArrayBuffer,
      200,
      'https://file.onejav.com/torrents/abc/1/a.torrent'
    )

    const error = await fetchTorrentBase64(URL_TORRENT).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('file.onejav.com')
    expect((error as Error).message).not.toContain('不是有效的种子文件')
  })

  it('Turnstile 挑战：没有通道时同样判拦截（不再有「跳过」逻辑）', async () => {
    gmMock.mockImplementation(((details: GmDetails) => {
      turnstileOn(details)
      return { abort: vi.fn<() => void>() }
    }) as unknown as typeof GM_xmlhttpRequest)

    const error = await fetchTorrentBase64(URL_TORRENT).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('Turnstile 验证')
  })
})

describe('fetchTorrentBase64 · 交给 miao 代下载', () => {
  beforeEach(() => {
    PROXY.mockClear()
    PROXY.mockImplementation(async () => GRANTED_BINARY)
  })

  it('代下载成功 → 直接用它，不再发 GM 请求', async () => {
    await expect(fetchTorrentBase64(URL_TORRENT, { proxy: PROXY })).resolves.toBe('ZGU=')

    expect(PROXY).toHaveBeenCalledWith(URL_TORRENT)
    // 关键：字节由 miao 的浏览器取，脚本侧不参与（GM 改不了 UA，必然吃挑战）
    expect(gmMock).not.toHaveBeenCalled()
  })

  it('代下载回来的不是 bencode → TorrentFetchError，不把 HTML 当种子', async () => {
    // base64('<htm') = 'PGh0bWw' → 首字节 0x3c，不是 bencode 的 'd'
    PROXY.mockResolvedValue({ ...GRANTED_BINARY, base64: 'PGh0bWw+PGJvZHk+' })

    await expect(fetchTorrentBase64(URL_TORRENT, { proxy: PROXY })).rejects.toThrow('有效的种子文件')
  })

  it('代下载超过 5MiB 上限 → TorrentFetchError', async () => {
    PROXY.mockResolvedValue({ ...GRANTED_BINARY, size: 5 * 1024 * 1024 + 1 })

    await expect(fetchTorrentBase64(URL_TORRENT, { proxy: PROXY })).rejects.toThrow('5MiB')
  })

  it('代下载失败 + GM 也被拦 → 拦截文案带上代下载的原因', async () => {
    respondChallenge(challengePage())
    PROXY.mockResolvedValue({ ok: false, reason: '过盾器未启动或地址不可达' })

    const error = await fetchTorrentBase64(URL_TORRENT, { proxy: PROXY }).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取未通过：过盾器未启动或地址不可达')
    expect(gmMock).toHaveBeenCalledTimes(1)
  })

  it('代下载失败但 GM 能下 → 回落 GM（exhentai 靠浏览器登录态）', async () => {
    respondWith(bytes(0x64, 0x65))
    PROXY.mockResolvedValue({ ok: false, reason: '该站点不在 miao 的站点白名单内' })

    await expect(fetchTorrentBase64(URL_TORRENT, { proxy: PROXY })).resolves.toBe('ZGU=')
    expect(gmMock).toHaveBeenCalledTimes(1)
  })

  it('通道自己报错（不该发生）→ 折成失败原因，不把原始错误抛给下载链', async () => {
    respondChallenge(challengePage())
    PROXY.mockRejectedValue(new Error('boom'))

    const error = await fetchTorrentBase64(URL_TORRENT, { proxy: PROXY }).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取未通过：boom')
  })
})

const ONEJAV_TORRENT = 'https://file.onejav.com/torrents/abc/1/a.torrent'

describe('fetchTorrentBase64 · 独占 auto 代下载（onejav）', () => {
  beforeEach(() => {
    PROXY.mockClear()
    PROXY.mockImplementation(async () => GRANTED_BINARY)
  })

  it('代下载成功 → 只有一次 web.download，不发 GM 请求', async () => {
    await expect(fetchTorrentBase64(ONEJAV_TORRENT, { proxy: PROXY, proxyOnly: true })).resolves.toBe('ZGU=')

    expect(PROXY).toHaveBeenCalledWith(ONEJAV_TORRENT)
    expect(gmMock).not.toHaveBeenCalled()
  })

  it('代下载失败 → 不回落 GM，直接判 blocked 并带上 miao 的原因', async () => {
    PROXY.mockResolvedValue({ ok: false, reason: '过盾器未启动或地址不可达' })

    const error = await fetchTorrentBase64(ONEJAV_TORRENT, { proxy: PROXY, proxyOnly: true }).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取未通过：过盾器未启动或地址不可达')
    expect(gmMock).not.toHaveBeenCalled()
  })

  it('代下载拿回的不是种子 → 也判 blocked，不外溢到迅雷', async () => {
    PROXY.mockResolvedValue({ ...GRANTED_BINARY, base64: 'PGh0bWw+PGJvZHk+' })

    const error = await fetchTorrentBase64(ONEJAV_TORRENT, { proxy: PROXY, proxyOnly: true }).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('有效的种子文件')
    expect(gmMock).not.toHaveBeenCalled()
  })

  it('通道自己抛错 → 同样折成 blocked，不漏进下载主链路', async () => {
    PROXY.mockRejectedValue(new Error('boom'))

    const error = await fetchTorrentBase64(ONEJAV_TORRENT, { proxy: PROXY, proxyOnly: true }).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('miao 代取未通过：boom')
    expect(gmMock).not.toHaveBeenCalled()
  })

  it('声明独占却没给通道 → 配置错误，也不发 GM 请求', async () => {
    await expect(fetchTorrentBase64(ONEJAV_TORRENT, { proxyOnly: true })).rejects.toThrow(
      '独占代下载未配置 miao 通道'
    )
    expect(gmMock).not.toHaveBeenCalled()
  })
})

describe('navigationHeaders', () => {
  it('带齐导航特征，Referer 为空时不写空值', () => {
    const headers = navigationHeaders()
    expect(headers['Sec-Fetch-Dest']).toBe('document')
    expect(headers['Sec-Fetch-Mode']).toBe('navigate')
    expect(headers.Accept).toContain('text/html')
    expect(headers).not.toHaveProperty('Referer')
  })

  it('给了 referer 就带上', () => {
    expect(navigationHeaders('https://onejav.com/').Referer).toBe('https://onejav.com/')
  })
})
