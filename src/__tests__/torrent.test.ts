import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import { fetchTorrentBase64, TorrentFetchError } from '@/download/torrent.ts'
import { CloudflareBlockedError } from '@/common/cloudflare'

const clearanceMock = vi.hoisted(() => ({
  ensureClearance: vi.fn<(input: unknown) => Promise<{ cookieHeader?: string; reason?: string }>>()
}))

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  monkeyWindow: {}
}))
vi.mock('@/common/cloudflare-guard', () => ({ ensureClearance: clearanceMock.ensureClearance }))

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

function respondWith(buffer: ArrayBuffer | string) {
  gmMock.mockImplementation(((details: GmDetails) => {
    details.onload?.({ response: buffer })
    return { abort: vi.fn<() => void>() }
  }) as unknown as typeof GM_xmlhttpRequest)
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
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
  const CF_HEADERS = 'server: cloudflare\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC'
  const CHALLENGE = new TextEncoder().encode(
    '<html><head><title>Just a moment...</title></head></html>'
  ).buffer as ArrayBuffer
  const CLEARANCE = { site: 'onejav', cookieDomain: 'onejav.com' }

  /** 按调用顺序回放响应：第 1 次挑战页，第 2 次给什么由用例决定 */
  function respondSequence(buffers: ArrayBuffer[]) {
    let index = 0
    gmMock.mockImplementation(((details: GmDetails) => {
      const buffer = buffers[index++] ?? new ArrayBuffer(0)
      details.onload?.({
        response: buffer,
        status: 403,
        responseHeaders: CF_HEADERS,
        finalUrl: URL_TORRENT
      })
      return { abort: vi.fn<() => void>() }
    }) as unknown as typeof GM_xmlhttpRequest)
  }

  it('挑战页且没有兜底配置 → CloudflareBlockedError，不尝试预热凭据', async () => {
    respondSequence([CHALLENGE])

    const error = await fetchTorrentBase64(URL_TORRENT).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('Cloudflare 拦截')
    expect(clearanceMock.ensureClearance).not.toHaveBeenCalled()
  })

  it('挑战页 → 换取 cf_clearance 后重取一次，成功返回 base64', async () => {
    respondSequence([CHALLENGE, bytes(0x64, 0x65)])
    clearanceMock.ensureClearance.mockResolvedValue({ cookieHeader: 'cf_clearance=token' })

    await expect(fetchTorrentBase64(URL_TORRENT, { clearance: CLEARANCE })).resolves.toBe('ZGU=')

    expect(clearanceMock.ensureClearance).toHaveBeenCalledWith(
      expect.objectContaining({ site: 'onejav', url: URL_TORRENT, cookieDomain: 'onejav.com' })
    )
    const retry = gmMock.mock.calls[1]?.[0] as { headers?: Record<string, string> }
    expect(retry.headers?.Cookie).toBe('cf_clearance=token')
  })

  it('预热失败 → CloudflareBlockedError，文案带上底层原因', async () => {
    respondSequence([CHALLENGE])
    clearanceMock.ensureClearance.mockResolvedValue({ reason: 'FlareSolverr 请求超时' })

    const error = await fetchTorrentBase64(URL_TORRENT, { clearance: CLEARANCE }).catch(
      (reason: unknown) => reason
    )

    expect(error).toBeInstanceOf(CloudflareBlockedError)
    expect((error as Error).message).toContain('FlareSolverr 请求超时')
    expect(gmMock).toHaveBeenCalledTimes(1)
  })

  it('带凭据重取仍是挑战页 → CloudflareBlockedError，提示去浏览器过验证', async () => {
    respondSequence([CHALLENGE, CHALLENGE])
    clearanceMock.ensureClearance.mockResolvedValue({ cookieHeader: 'cf_clearance=token' })

    await expect(fetchTorrentBase64(URL_TORRENT, { clearance: CLEARANCE })).rejects.toThrow(
      '请在浏览器打开站点通过验证后重试'
    )
    expect(gmMock).toHaveBeenCalledTimes(2)
  })
})
