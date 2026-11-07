/**
 * Cloudflare 拦截识别层：纯函数，无 IO、无 DOM 依赖。
 *
 * 判定不依赖单一文案：响应头（`cf-mitigated` / `cf-ray` 配状态码）最稳，页面特征作补充。
 * 页面特征必须「只在拦截页出现」才可用 —— CF 会给正常页注入 JS 检测脚本，
 * 拿脚本地址判拦截会把正常页误判成挑战页（见 `CHALLENGE_BODY_MARKERS` 的说明）。
 */

/** 判定只看响应体前 8KB：挑战页/封禁页的信号都在页头 */
export const CLOUDFLARE_PROBE_CHARS = 8192

/** 响应探针：把一次响应里可用的判据收拢成纯数据，便于单测与跨链路复用 */
export interface CloudflareProbe {
  status: number
  /** GM_xmlhttpRequest 的 responseHeaders 原始字符串 */
  responseHeaders?: string
  /** 响应体前若干字节的文本（HTML 页直接取 responseText；二进制先解码再截断） */
  body?: string
  /** GM 请求的最终 URL（跟随重定向后） */
  finalUrl?: string
}

export type CloudflareBlockKind =
  /**
   * Turnstile 小部件挑战：托管页里嵌的是 Turnstile，只认真实浏览器交互。
   * 与「挑战页」分开是因为排查口径不一样：这种页面失败时更可能是站点策略拒绝了自动化浏览器，
   * 而不是过盾器没跑起来。
   */
  | 'turnstile'
  /** JS 挑战页（cf-mitigated: challenge / Just a moment... / challenge-platform） */
  | 'challenge'
  /** WAF 封禁页（Attention Required! / 1020 / 403 + cf-ray） */
  | 'blocked'
  /** 触发限流（429 / 1015） */
  | 'rate-limited'

export interface CloudflareBlock {
  kind: CloudflareBlockKind
  status: number
  /** CF 的 Ray ID，排查时提供给站点/CF 支持 */
  rayId?: string
  /** 命中的具体信号，只用于日志与诊断，不进用户文案 */
  evidence: string
}

interface Signals {
  kind: CloudflareBlockKind
  evidence: string
}

/**
 * Turnstile 特征：命中任一即可。
 * 用具体脚本地址 / 小部件类名，不用「turnstile」这个词 —— 经典 IUAM 页里也会提到它。
 */
const TURNSTILE_BODY_MARKERS = [
  'cf-turnstile',
  'challenges.cloudflare.com/turnstile',
  'turnstile/v0/api.js',
  'turnstile.render'
]

/**
 * 挑战页特征：命中任一即可（顺序即优先级）。
 *
 * 只收「只在挑战页出现」的信号。`/cdn-cgi/challenge-platform/` 与 `challenges.cloudflare.com`
 * 不能单独当判据：CF 会在**正常页面**里内联 `challenge-platform/scripts/jsd/main.js`
 * 做 JS 检测（onejav 列表页实测含此脚本），拿脚本地址判拦截会把正常页误判成挑战页 ——
 * 结果是白过一次盾、重取后仍被误判，最后报「拦截」。
 */
const CHALLENGE_BODY_MARKERS = [
  'just a moment',
  '_cf_chl_opt',
  'enable javascript and cookies to continue',
  'cf-browser-verification',
  'cf-chl-widget',
  'challenge-form',
  'challenge-running',
  'challenge-stage'
]

/** 挑战骨架的长度上限：整页只有骨架、没有正文时才可能这么短 */
const CHALLENGE_SKELETON_MAX_CHARS = 4096

/** 封禁页特征 */
const BLOCKED_BODY_MARKERS = [
  'attention required! | cloudflare',
  'cf-error-details',
  'error code: 1020',
  'sorry, you have been blocked',
  'the owner of this website has banned your access'
]

/** 限流页特征 */
const RATE_LIMITED_BODY_MARKERS = ['error code: 1015', 'you are being rate limited']

/** 判为拦截的响应头状态组合（challenge 之外） */
const BLOCKED_STATUSES = new Set([403, 503])

/** GM_xmlhttpRequest 的 responseHeaders 是原始字符串，统一解析成小写键以便查表 */
export function parseResponseHeaders(raw: string | undefined): Map<string, string> {
  const headers = new Map<string, string>()
  if (!raw) return headers
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    headers.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim())
  }
  return headers
}

/** CF 的 cf-ray 形如 8f2a1c3b4d5e6f70-SJC，取 '-' 前的主机部分 */
export function parseRayId(value: string | undefined): string | undefined {
  if (!value) return undefined
  const ray = value.split('-')[0]?.trim()
  return ray ? ray : undefined
}

function rayFromBody(body: string): string | undefined {
  const match = /Ray ID:\s*([0-9a-z]+)/i.exec(body)
  return match?.[1]
}

function findMarker(body: string, markers: string[]): string | undefined {
  const lower = body.toLowerCase()
  return markers.find((marker) => lower.includes(marker))
}

/** 种子文件（bencode 顶层字典以 'd' 开头）：内容里偶然出现文案也不该判成拦截页 */
function isBencodeLike(body: string): boolean {
  return body.charCodeAt(0) === 0x64
}

function detectByHeaders(
  headers: Map<string, string>,
  status: number,
  hasCloudflare: boolean
): Signals | undefined {
  const mitigated = headers.get('cf-mitigated')
  if (mitigated && mitigated.toLowerCase().includes('challenge')) {
    return { kind: 'challenge', evidence: `响应头 cf-mitigated: ${mitigated}` }
  }
  if (status === 429 && hasCloudflare) {
    return { kind: 'rate-limited', evidence: `响应头 cf-ray + 状态码 ${status}` }
  }
  if (BLOCKED_STATUSES.has(status) && hasCloudflare) {
    return { kind: 'blocked', evidence: `响应头 cf-ray + 状态码 ${status}` }
  }
  return undefined
}

/**
 * 挑战骨架：挑战平台脚本 + 极短页面。
 *
 * `challenge-platform` 自身不是判据（正常页也内联 jsd 检测脚本），但只吐一个脚本骨架、
 * 连正文都没有的页面只可能是挑战页。
 */
function isChallengeSkeletonPage(body: string): boolean {
  return body.includes('/cdn-cgi/challenge-platform/') && body.length < CHALLENGE_SKELETON_MAX_CHARS
}

function detectByBody(body: string): Signals | undefined {
  const challenge = findMarker(body, CHALLENGE_BODY_MARKERS)
  if (challenge) return { kind: 'challenge', evidence: `页面特征 ${challenge}` }
  if (isChallengeSkeletonPage(body)) {
    return { kind: 'challenge', evidence: '页面特征 挑战骨架（challenge-platform + 极短页面）' }
  }

  const blocked = findMarker(body, BLOCKED_BODY_MARKERS)
  if (blocked) return { kind: 'blocked', evidence: `页面特征 ${blocked}` }

  const rateLimited = findMarker(body, RATE_LIMITED_BODY_MARKERS)
  if (rateLimited) return { kind: 'rate-limited', evidence: `页面特征 ${rateLimited}` }
  return undefined
}

function detectByFinalUrl(finalUrl: string | undefined): Signals | undefined {
  if (!finalUrl) return undefined
  if (finalUrl.includes('/cdn-cgi/challenge-platform/')) {
    return { kind: 'challenge', evidence: '最终 URL 落在挑战平台' }
  }
  if (finalUrl.includes('/cdn-cgi/l/chk_')) {
    return { kind: 'challenge', evidence: '最终 URL 落在挑战跳转' }
  }
  return undefined
}

/**
 * 未拦截返回 null；命中返回结构化结论。
 * 判定优先级：Turnstile > 响应头（挑战 / 封禁 / 限流）> 其余页面特征 > 最终 URL，
 * 同级别取第一个命中的信号。
 */
export function detectCloudflareBlock(probe: CloudflareProbe): CloudflareBlock | null {
  const body = probe.body ?? ''
  if (body && isBencodeLike(body)) return null

  const headers = parseResponseHeaders(probe.responseHeaders)
  const hasCloudflare =
    headers.has('cf-ray') || (headers.get('server') ?? '').toLowerCase().includes('cloudflare')

  // Turnstile 先于响应头判定：托管挑战页常是「403 + cf-ray」，只看头会归成封禁，
  // 调用方就分不清该不该尝试 FlareSolverr
  const turnstile = findMarker(body, TURNSTILE_BODY_MARKERS)
  const signals =
    (turnstile ? { kind: 'turnstile' as const, evidence: `页面特征 ${turnstile}` } : undefined) ??
    detectByHeaders(headers, probe.status, hasCloudflare) ??
    detectByBody(body) ??
    detectByFinalUrl(probe.finalUrl)
  if (!signals) return null

  const rayId = parseRayId(headers.get('cf-ray')) ?? rayFromBody(body)
  return {
    kind: signals.kind,
    status: probe.status,
    ...(rayId ? { rayId } : {}),
    evidence: signals.evidence
  }
}

const KIND_LABELS: Record<CloudflareBlockKind, string> = {
  turnstile: 'Turnstile 验证',
  challenge: '挑战页',
  blocked: '访问封禁',
  'rate-limited': '请求过快'
}

/**
 * 拦截错误末尾「还剩什么路」的措辞：有没有代取通道、代取为什么没成。
 * 页面抓取与种子字节两条路共用这一处口径，避免同一件事两种说法。
 *
 * 代取通道由 miao 提供（见 `@/download/miao-proxy.ts`），失败原因取自服务端
 * 错误码，所以这里只负责把「试过 / 没试」和原因拼成一句给用户看的话。
 */
export function describeProxyFailure(input: { attempted: boolean; reason?: string }): string {
  if (!input.attempted) return '脚本请求无法通过该站点验证'
  return input.reason ? `miao 代取未通过：${input.reason}` : 'miao 代取未通过该站点验证'
}

/**
 * 拦截错误：`message` 就是给用户看的备注文案（经下载通知的「备注」行展示），
 * 结构化字段只用于日志与诊断，避免把整页 HTML 塞进通知。
 */
export class CloudflareBlockedError extends Error {
  readonly block: CloudflareBlock
  readonly site: string

  constructor(site: string, block: CloudflareBlock, cause?: string) {
    const ray = block.rayId ? `，Ray ${block.rayId}` : ''
    const tail = cause ? `，${cause}` : ''
    super(`${site} 被 Cloudflare 拦截（${KIND_LABELS[block.kind]}${ray}）${tail}`)
    this.name = 'CloudflareBlockedError'
    this.site = site
    this.block = block
  }
}

/** 日志口径：只记形态与定位信息，不打整页 HTML */
export function describeCloudflareBlock(block: CloudflareBlock): Record<string, unknown> {
  return { kind: block.kind, status: block.status, rayId: block.rayId, evidence: block.evidence }
}
