import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'

/** 服务端 torrentBase64 的硬上限（base64 解码后 ≤ 5MiB） */
const MAX_TORRENT_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 30_000

export class TorrentFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TorrentFetchError'
  }
}

/**
 * 下载远程 .torrent 并编码为 base64（对应服务端 `torrentBase64` 入参）。
 *
 * 走 GM_xmlhttpRequest：油猴请求自带站点 Cookie（exhentai/onejav 的种子链接需要登录态），
 * 且不受同源策略约束。服务端不经过种子目录白名单，只校验 5MiB 上限与 bencode 合法性。
 */
export function fetchTorrentBase64(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  // 带上当前站点 Referer（部分站点种子链接有防盗链）；非浏览器环境（单测）下不传
  const referer = typeof location !== 'undefined' ? `${location.origin}/` : undefined
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url,
      method: 'GET',
      headers: referer ? { Referer: referer } : undefined,
      responseType: 'arraybuffer',
      timeout: timeoutMs,
      onload: (res) => {
        const buffer = res.response
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
          reject(new TorrentFetchError('种子链接返回了空内容'))
          return
        }
        if (buffer.byteLength > MAX_TORRENT_BYTES) {
          reject(new TorrentFetchError('种子超过 5MiB 上限，无法投递给 miao'))
          return
        }
        const bytes = new Uint8Array(buffer)
        // bencode 顶层是字典，首字节应为 'd'；HTML 登录页/错误页会在这里被拦下
        if (bytes[0] !== 0x64) {
          reject(new TorrentFetchError('响应不是有效的种子文件（链接可能失效或需要登录）'))
          return
        }
        resolve(bytesToBase64(bytes))
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

/** 分块编码，避免 String.fromCharCode 参数过多导致爆栈 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}
