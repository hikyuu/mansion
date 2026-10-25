import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import { fetchTorrentBase64, TorrentFetchError } from '@/download/torrent.ts'
import { CloudflareBlockedError } from '@/common/cloudflare'
import { navigationHeaders } from '@/common/navigation-headers.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
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

describe('fetchTorrentBase64 · Cloudflare 拦截', () => {
  it('403 挑战页 → CloudflareBlockedError，提示交给浏览器，不重试', async () => {
    respondChallenge(challengePage())

    const error = await fetchTorrentBase64(URL_TORRENT).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('Cloudflare 拦截')
    expect((error as Error).message).toContain('交给浏览器')
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
