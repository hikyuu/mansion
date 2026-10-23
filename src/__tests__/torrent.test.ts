import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import { fetchTorrentBase64, TorrentFetchError } from '@/download/torrent.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  monkeyWindow: {}
}))

const gmMock = vi.mocked(GM_xmlhttpRequest)

interface GmDetails {
  url: string
  onload?: (res: { response: ArrayBuffer | string }) => void
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
