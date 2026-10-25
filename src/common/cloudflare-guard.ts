import type { GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import { request } from '@/common/common'
import {
  CLOUDFLARE_PROBE_CHARS,
  CloudflareBlockedError,
  describeCloudflareBlock,
  detectCloudflareBlock,
  parseResponseHeaders,
  type CloudflareBlock,
  type CloudflareProbe
} from '@/common/cloudflare'
import { listCookies, type GmCallbackCookie } from '@/common/flare-solverr'
import { SessionPool } from '@/common/session-pool'

/** cf_clearance 内存缓存时长上限；CF 侧实际有效期由站点配置决定，过期后重取即可 */
const CLEARANCE_TTL_MS = 20 * 60 * 1000

const sessionPool = SessionPool.getInstance()

/** 本会话内已确认被拦截的站点：此后该站点的页面请求直接走兜底，不再先撞墙 */
const bypassSites = new Set<string>()

interface ClearanceEntry {
  /** 可直接注入 Cookie 头的片段（cf_clearance=...） */
  cookieHeader: string
  expiresAt: number
}

/** 只存内存：cf_clearance 是会话凭据，不写 GM 存储、不进日志 */
const clearances = new Map<string, ClearanceEntry>()

export interface CloudflarePageInput {
  /** 站点标识：SessionPool 分桶与 bypass 标记的键，如 'onejav' */
  site: string
  /** 错误文案里展示的站点名，缺省用 cookieDomain */
  siteLabel?: string
  url: string
  referer?: string
  /** 读取站点 cookie 的域名，如 'onejav.com' */
  cookieDomain: string
}

export interface CloudflarePage {
  url: string
  status: number
  html: string
  /** 响应头（小写键）：调用方靠 content-type 判断「是页面还是文件」 */
  headers: Record<string, string>
  /** direct=GM 直取；fallback=经 FlareSolverr 过挑战后取回 */
  via: 'direct' | 'fallback'
}

export interface ClearanceResult {
  /** 可注入 Cookie 头的 cf_clearance 片段 */
  cookieHeader?: string
  /** 没拿到凭据的原因（供上层拼提示） */
  reason?: string
}

/** 已切兜底的站点再失败时，没有直取的 block 可复用，按「本会话已确认被拦截」报 */
const PRESUMED_BLOCK: CloudflareBlock = {
  kind: 'challenge',
  status: 0,
  evidence: '该站点本会话内已确认被 Cloudflare 拦截'
}

function probeOfResponse(res: GmResponseEvent<'document'>): CloudflareProbe {
  return {
    status: res.status,
    responseHeaders: res.responseHeaders,
    body: res.responseText.slice(0, CLOUDFLARE_PROBE_CHARS),
    finalUrl: res.finalUrl
  }
}

/** Solution.headers 是键值对，识别层要的是原始头字符串，这里还原成同一形状 */
function headersToString(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n')
}

function rememberClearance(site: string, cookies: Record<string, string>): void {
  const value = cookies['cf_clearance']
  if (!value) return
  clearances.set(site, {
    cookieHeader: `cf_clearance=${value}`,
    expiresAt: Date.now() + CLEARANCE_TTL_MS
  })
  // 凭据只记长度，避免把 token 写进控制台
  console.log('[cloudflare] 已缓存 cf_clearance', { site, length: value.length })
}

/** 取未过期的 cf_clearance 头片段，供二进制链路重试时注入 */
export function getClearanceCookieHeader(site: string): string | undefined {
  const entry = clearances.get(site)
  if (!entry) return undefined
  if (Date.now() >= entry.expiresAt) {
    clearances.delete(site)
    return undefined
  }
  return entry.cookieHeader
}

async function cookiesOf(domain: string): Promise<GmCallbackCookie[]> {
  try {
    return await listCookies(domain)
  } catch (error) {
    // 读不到 cookie 只影响登录态，不影响过挑战本身
    console.warn('[cloudflare] 读取站点 cookie 失败，按未登录态过挑战', { domain, error })
    return []
  }
}

async function viaFallback(
  input: CloudflarePageInput,
  label: string,
  directBlock: CloudflareBlock | null
): Promise<CloudflarePage> {
  try {
    const cookies = await cookiesOf(input.cookieDomain)
    const { solution } = await sessionPool.request(input.site, input.url, cookies)
    rememberClearance(input.site, solution.cookies)

    const html = solution.response ?? ''
    const block = detectCloudflareBlock({
      status: solution.status,
      responseHeaders: headersToString(solution.headers),
      body: html.slice(0, CLOUDFLARE_PROBE_CHARS),
      finalUrl: solution.url
    })
    if (block) {
      console.warn('[cloudflare] 兜底后仍被拦截', {
        site: input.site,
        url: input.url,
        ...describeCloudflareBlock(block)
      })
      throw new CloudflareBlockedError(label, block, 'FlareSolverr 兜底仍返回拦截页')
    }
    return {
      url: solution.url || input.url,
      status: solution.status,
      html,
      headers: solution.headers,
      via: 'fallback'
    }
  } catch (error) {
    if (error instanceof CloudflareBlockedError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    console.warn('[cloudflare] FlareSolverr 兜底失败', { site: input.site, url: input.url, reason })
    throw new CloudflareBlockedError(label, directBlock ?? PRESUMED_BLOCK, `FlareSolverr 兜底未成功：${reason}`)
  }
}

/**
 * 取页面 HTML：GM 直取 → 识别拦截 → 命中则切 FlareSolverr 兜底（此后该站点一律走兜底）。
 *
 * 拦截识别优先于业务解析：挑战页的 finalUrl 与原 URL 相同、状态码也可能是 200，
 * 交给业务层去判断只会得出「没有可下载种子」这种误导性结论。
 */
export async function fetchPageThroughCloudflare(input: CloudflarePageInput): Promise<CloudflarePage> {
  const label = input.siteLabel ?? input.cookieDomain
  let directBlock: CloudflareBlock | null = null

  if (!bypassSites.has(input.site)) {
    const referer = input.referer ?? `https://${input.cookieDomain}/`
    const res = await request(input.url, referer)
    directBlock = detectCloudflareBlock(probeOfResponse(res))
    if (!directBlock) {
      return {
        url: res.finalUrl || input.url,
        status: res.status,
        html: res.responseText,
        headers: Object.fromEntries(parseResponseHeaders(res.responseHeaders)),
        via: 'direct'
      }
    }
    bypassSites.add(input.site)
    console.warn('[cloudflare] 命中拦截，切换 FlareSolverr 兜底', {
      site: input.site,
      url: input.url,
      ...describeCloudflareBlock(directBlock)
    })
  }

  return viaFallback(input, label, directBlock)
}

/**
 * 为二进制链路预热 cf_clearance：FlareSolverr 的 request.get 只返回文本，
 * 无法代下 .torrent，只能先过挑战换凭据，再让 GM 请求带 Cookie 重试。
 * 兜底不可用时不抛错，把原因交回调用方决定文案。
 */
export async function ensureClearance(input: CloudflarePageInput): Promise<ClearanceResult> {
  const cached = getClearanceCookieHeader(input.site)
  if (cached) return { cookieHeader: cached }

  const label = input.siteLabel ?? input.cookieDomain
  try {
    await viaFallback(input, label, null)
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) }
  }

  const header = getClearanceCookieHeader(input.site)
  if (!header) {
    return { reason: 'FlareSolverr 通过挑战但未返回 cf_clearance（无头浏览器 UA 与当前浏览器不一致时会如此）' }
  }
  return { cookieHeader: header }
}
