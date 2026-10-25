/**
 * 让 GM 请求与浏览器导航同形。
 *
 * Cloudflare 的托管挑战对「XHR 形态」的请求更敏感：缺 Sec-Fetch-*、Accept 是 `* / *` 时，
 * 即使浏览器持有该站点的 cf_clearance 也可能被单独挑战。种子下载这类「必须拿到原始字节」的链路
 * 一旦被误伤就等于直接没有文件，所以统一按导航请求发。
 *
 * 纯字符串拼装、不碰 DOM：种子链路（torrent.ts）要在 node 环境的单测里 import 它。
 */
export function navigationHeaders(referer: string = ''): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1'
  }
  if (referer) headers.Referer = referer
  return headers
}
