import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import {
  CLOUDFLARE_PROBE_CHARS,
  CloudflareBlockedError,
  describeCloudflareBlock,
  describeProxyFailure,
  detectCloudflareBlock,
  type CloudflareProbe
} from '@/common/cloudflare'
import {
  tryProxy,
  type BinaryFetchProvider,
  type BinaryFetchResult
} from '@/common/miao-proxy.ts'
import { navigationHeaders } from '@/common/navigation-headers.ts'

/** 服务端 torrentBase64 的硬上限（base64 解码后 ≤ 5MiB） */
const MAX_TORRENT_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

export class TorrentFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TorrentFetchError'
  }
}

export interface TorrentFetchOptions {
  timeoutMs?: number
  /**
   * 交给 miao 代下载（`web.download`）。
   *
   * onejav 这类站点对「页面内 XHR」一律下挑战，浏览器栈（GM 请求）拿不到字节；
   * 请求必须由 miao 发。不给 = 只走 GM（exhentai 靠浏览器登录态，miao 没有那份 cookie）。
   */
  proxy?: BinaryFetchProvider
  /**
   * 只用代下载通道（onejav）：种子字节只交给 miao 的 `web.download({ mode: 'auto' })`，不回落 GM。
   *
   * 代下载失败时不再回落 GM —— 那条请求必然被 Turnstile 拦下，白等一个超时还会把
   * miao 的真实失败原因（白名单 / 过盾器 / token）盖成「站点拦截」。直接判 blocked，
   * 由意图层改投解析阶段挂好的备用地址。
   */
  proxyOnly?: boolean
}

interface TorrentResponse {
  buffer: ArrayBuffer
  status: number
  responseHeaders?: string
  finalUrl?: string
}

/** 带上当前站点 Referer（部分站点种子链接有防盗链）；非浏览器环境（单测）下不传 */
function refererOf(): string | undefined {
  return typeof location !== 'undefined' ? `${location.origin}/` : undefined
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** 发一次种子下载请求（浏览器栈：自带站点 Cookie，exhentai 靠它拿登录态） */
function requestBuffer(url: string, timeoutMs: number): Promise<TorrentResponse> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      // 按导航形态发，减少「XHR 被单独挑战」的误伤
      headers: navigationHeaders(refererOf() ?? ''),
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      onload: (res) => {
        const buffer = res.response
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
          reject(new TorrentFetchError('种子链接返回了空内容'))
          return
        }
        resolve({
          buffer,
          status: res.status ?? 0,
          responseHeaders: res.responseHeaders,
          finalUrl: res.finalUrl
        })
      },
      onerror: (err) => {
        reject(new TorrentFetchError('下载种子失败' + (err.error ? `：${err.error}` : '')))
      },
      ontimeout: () => {
        reject(new TorrentFetchError('下载种子超时'))
      },
      onabort: () => {
        reject(new TorrentFetchError('下载种子已中止'))
      }
    })
  })
}

/** 二进制先按文本解码前 8KB 再判定：挑战页一定是 HTML，种子起始字节是 bencode 的 'd' */
function probeOf(res: TorrentResponse): CloudflareProbe {
  const head = new Uint8Array(res.buffer, 0, Math.min(res.buffer.byteLength, CLOUDFLARE_PROBE_CHARS))
  return {
    status: res.status,
    responseHeaders: res.responseHeaders,
    body: new TextDecoder('utf-8', { fatal: false }).decode(head),
    finalUrl: res.finalUrl
  }
}

function toBase64(res: TorrentResponse): string {
  if (res.buffer.byteLength > MAX_TORRENT_BYTES) {
    throw new TorrentFetchError('种子超过 5MiB 上限，无法投递给 miao')
  }
  const bytes = new Uint8Array(res.buffer)
  // bencode 顶层是字典，首字节应为 'd'；HTML 登录页/错误页会在这里被拦下
  if (bytes[0] !== 0x64) {
    throw new TorrentFetchError('响应不是有效的种子文件（链接可能失效或需要登录）')
  }
  return bytesToBase64(bytes)
}

/**
 * 下载远程 .torrent 并编码为 base64（对应服务端 `torrentBase64` 入参）。
 *
 * `proxyOnly` 的站点（onejav）只有一条路：`web.download({ mode: 'auto' })`，
 * 代下载失败或拿回的不是种子都判 blocked 交给上层换地址，不外溢到 GM / 迅雷。
 * 其余站点先试 `proxy`，失败回落 GM 直取（exhentai 依赖浏览器登录态，miao 没有那份 cookie）。
 *
 * GM 路径命中拦截时同样抛 CloudflareBlockedError。
 */
export async function fetchTorrentBase64(url: string, options: TorrentFetchOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS

  const proxied = await tryProxy(options.proxy, url)

  if (options.proxyOnly) {
    if (!options.proxy) throw new TorrentFetchError('独占代下载未配置 miao 通道')
    const blocked = (reason: string) => {
      console.warn('[torrent] 浏览器代下载未取到种子字节', { url, reason })
      return new CloudflareBlockedError(
        hostOf(url),
        { kind: 'challenge', status: 403, evidence: 'miao web.download(mode: auto) 未返回种子字节' },
        reason
      )
    }
    if (proxied?.ok === true) {
      try {
        return fromProxy(url, proxied)
      } catch (error) {
        throw blocked(error instanceof Error ? error.message : String(error))
      }
    }
    throw blocked(
      describeProxyFailure({
        attempted: true,
        ...(proxied && !proxied.ok ? { reason: proxied.reason } : {})
      })
    )
  }

  if (proxied?.ok === true) return fromProxy(url, proxied)

  const res = await requestBuffer(url, timeoutMs)
  const block = detectCloudflareBlock(probeOf(res))
  if (!block) return toBase64(res)

  // 文案用最终主机：重定向后的 file.* 才是真正被拦的下载源
  const label = hostOf(res.finalUrl || url)
  console.warn('[torrent] 种子下载命中 Cloudflare 拦截', {
    url,
    proxyFailed: proxied === null ? undefined : proxied.reason,
    ...describeCloudflareBlock(block)
  })
  throw new CloudflareBlockedError(
    label,
    block,
    describeProxyFailure({
      attempted: options.proxy !== undefined,
      ...(proxied && !proxied.ok ? { reason: proxied.reason } : {})
    })
  )
}

/**
 * miao 代下载结果 → base64。
 *
 * 校验口径与 GM 路径一致（大小 + bencode 首字节），只看前 8 个 base64 字符
 * 解出的头几个字节，不为了验一个字节去解码整颗种子。
 */
function fromProxy(url: string, proxied: BinaryFetchResult): string {
  if (proxied.size > MAX_TORRENT_BYTES) {
    throw new TorrentFetchError('种子超过 5MiB 上限，无法投递给 miao')
  }
  const first = atob(proxied.base64.slice(0, 8)).charCodeAt(0)
  if (first !== 0x64) {
    throw new TorrentFetchError('响应不是有效的种子文件（链接可能失效或需要登录）')
  }
  console.log('[torrent] miao 代下载成功', {
    url,
    size: proxied.size,
    contentType: proxied.contentType
  })
  return proxied.base64
}

/** 分块编码，避免 String.fromCharCode 参数过多导致爆栈 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
