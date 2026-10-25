import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import {
  CLOUDFLARE_PROBE_CHARS,
  CloudflareBlockedError,
  describeCloudflareBlock,
  detectCloudflareBlock,
  type CloudflareProbe
} from '@/common/cloudflare'
import { ensureClearance } from '@/common/cloudflare-guard'

/** 服务端 torrentBase64 的硬上限（base64 解码后 ≤ 5MiB） */
const MAX_TORRENT_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

export class TorrentFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TorrentFetchError'
  }
}

/** 命中 Cloudflare 时换取 cf_clearance 所需的站点信息 */
export interface TorrentClearanceOptions {
  /** SessionPool 分桶与 bypass 标记的键，如 'onejav' */
  site: string
  /** 读取站点 cookie 的域名，如 'onejav.com' */
  cookieDomain: string
  /** 文案里展示的站点名，缺省用种子链接的主机名 */
  siteLabel?: string
}

export interface TorrentFetchOptions {
  timeoutMs?: number
  /** 不传则命中拦截时只报原因，不做自动重试 */
  clearance?: TorrentClearanceOptions
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

function requestBuffer(url: string, timeoutMs: number, cookieHeader?: string): Promise<TorrentResponse> {
  const headers: Record<string, string> = {}
  const referer = refererOf()
  if (referer) headers.Referer = referer
  if (cookieHeader) headers.Cookie = cookieHeader

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
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
 * 走 GM_xmlhttpRequest：油猴请求自带站点 Cookie（exhentai/onejav 的种子链接需要登录态），
 * 且不受同源策略约束。服务端不经过种子目录白名单，只校验 5MiB 上限与 bencode 合法性。
 *
 * 命中 Cloudflare 时不能靠 FlareSolverr 代下（它的 request.get 只返回文本），
 * 只能先过挑战换 cf_clearance，再带 Cookie 重取一次；仍被拦就明确报拦截，
 * 而不是混在「链接可能失效」里让用户去猜。
 */
export async function fetchTorrentBase64(url: string, options: TorrentFetchOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const first = await requestBuffer(url, timeoutMs)
  const block = detectCloudflareBlock(probeOf(first))
  if (!block) return toBase64(first)

  const label = options.clearance?.siteLabel ?? hostOf(url)
  console.warn('[torrent] 种子下载命中 Cloudflare 拦截', { url, ...describeCloudflareBlock(block) })

  if (!options.clearance) {
    throw new CloudflareBlockedError(label, block, '未配置兜底站点，无法自动换取 cf_clearance')
  }

  const clearance = await ensureClearance({
    site: options.clearance.site,
    siteLabel: label,
    url,
    cookieDomain: options.clearance.cookieDomain
  })
  if (!clearance.cookieHeader) {
    throw new CloudflareBlockedError(
      label,
      block,
      `已尝试换取 cf_clearance 仍失败：${clearance.reason ?? '未知原因'}`
    )
  }

  const retry = await requestBuffer(url, timeoutMs, clearance.cookieHeader)
  const retryBlock = detectCloudflareBlock(probeOf(retry))
  if (retryBlock) {
    console.warn('[torrent] 带 cf_clearance 重取仍被拦截', { url, ...describeCloudflareBlock(retryBlock) })
    throw new CloudflareBlockedError(
      label,
      retryBlock,
      '已带 cf_clearance 重取仍被拦截，请在浏览器打开站点通过验证后重试'
    )
  }
  return toBase64(retry)
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
