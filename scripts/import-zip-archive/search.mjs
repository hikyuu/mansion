/**
 * exhentai 搜索的访问层：读取 cookie、限速请求、按失败类型分类。
 *
 * cookie 只从本地文件读，不落日志、不回显；命中限流/未登录时抛 SearchError，
 * 由调用方保存进度后停止（绝不在被封禁的状态下继续打站点）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { buildSearchUrl, parseSearchPage } from './lib.mjs'

/** 与 Edge 155 一致的 UA：cf_clearance 通常绑定 UA，命令行必须沿用 */
export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0'

export class SearchError extends Error {
  /**
   * @param {'rate-limited'|'auth'|'http'|'parse'} kind
   * @param {string} message
   * @param {string} [detail] 原始响应片段（排查用）
   * @param {number} [waitMs] 站点给出的封禁剩余时间（毫秒），可用于自动等待
   */
  constructor(kind, message, detail, waitMs) {
    super(message)
    this.name = 'SearchError'
    this.kind = kind
    this.detail = detail
    this.waitMs = waitMs
  }
}

/** 站点限流/封禁的纯文本响应（HTTP 200，242 字节左右） */
const BAN_PATTERN = /temporarily banned due to an excessive request rate/i

/** 从 "The ban expires in 4 minutes and 54 seconds" 里取出剩余毫秒 */
function parseBanWaitMs(text) {
  const minutes = text.match(/expires in\s+(\d+)\s*minutes?\s+and\s+(\d+)\s*seconds?/i)
  if (minutes) return (Number(minutes[1]) * 60 + Number(minutes[2])) * 1000
  const seconds = text.match(/expires in\s+(\d+)\s*seconds?/i)
  if (seconds) return Number(seconds[1]) * 1000
  return undefined
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 读取 cookie 文件。支持三种形态：
 *   1. `name=value; name2=value2`
 *   2. DevTools 的 "Copy as cURL"（自动提取 -b/--cookie）
 *   3. 带 `Cookie:` 头的文本
 */
export function loadCookie(cookieFile) {
  if (!existsSync(cookieFile)) {
    throw new Error(`cookie 文件不存在：${cookieFile}（先在 Edge DevTools 里 Copy as cURL 存到该路径）`)
  }
  let raw = readFileSync(cookieFile, 'utf8').trim()
  if (!raw) throw new Error(`cookie 文件为空：${cookieFile}`)

  const quoted = raw.match(/(?:-b|--cookie|Cookie:)\s*'([^']+)'/i) || raw.match(/(?:-b|--cookie|Cookie:)\s*"([^"]+)"/i)
  if (quoted) raw = quoted[1]

  const cookie = raw.replace(/\r?\n\s*/g, ' ').trim()
  if (!/ipb_member_id|ipb_pass_hash/.test(cookie)) {
    throw new Error('cookie 里没有 ipb_member_id / ipb_pass_hash，无法访问 exhentai')
  }
  return cookie
}

/**
 * 请求一次搜索页。
 * @returns {Promise<{candidates: object[], noHits: boolean}>}
 */
export async function searchGalleries(keyword, options = {}) {
  const { cookie, ua = DEFAULT_UA, timeoutMs = 20000 } = options
  const url = buildSearchUrl(keyword)

  let response
  try {
    response = await fetch(url, {
      headers: {
        cookie,
        'user-agent': ua,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (err) {
    throw new SearchError('http', err instanceof Error ? err.message : String(err))
  }

  const html = await response.text()

  // 站点限流返回的是 200 + 一段纯文本，必须优先识别，否则会被误判成"页面结构变化"
  if (BAN_PATTERN.test(html)) {
    const waitMs = parseBanWaitMs(html)
    throw new SearchError(
      'rate-limited',
      `IP 被临时封禁${waitMs ? `（剩余约 ${Math.ceil(waitMs / 60000)} 分钟）` : ''}`,
      html.slice(0, 200),
      waitMs
    )
  }
  if (response.status === 509 || /exceeded the search limit|too many requests|bandwidth/i.test(html)) {
    throw new SearchError('rate-limited', `搜索被限流（HTTP ${response.status}）`, html.slice(0, 200))
  }
  // 兜底：正常搜索页至少几十 KB 且含 </html>；过短的非 HTML 响应一律按限流处理
  if (html.length < 1500 && !/<\/html>/i.test(html)) {
    throw new SearchError('rate-limited', `返回内容异常（${html.length} 字节，疑似限流/封禁）`, html.slice(0, 200))
  }
  if (/sad panda/i.test(html) || /ipb_pass/i.test(html)) {
    throw new SearchError('auth', '页面被拦截或登录已失效', html.slice(0, 200))
  }
  if (!response.ok) {
    throw new SearchError('http', `HTTP ${response.status}`)
  }

  const parsed = parseSearchPage(html)
  if (!parsed.hasResultBlock && !parsed.noHits) {
    throw new SearchError('parse', '无法识别搜索结果页结构', html.slice(0, 500))
  }
  // html 只在排查时使用（校准阈值、核对页数等），正常流程按需忽略
  return { candidates: parsed.candidates, noHits: parsed.noHits, html }
}

/**
 * 带重试的单次搜索：限流/未登录直接抛出，其它错误重试一次。
 */
export async function searchWithRetry(keyword, options = {}) {
  const retry = Math.max(0, options.retry ?? 1)
  let lastError
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      return await searchGalleries(keyword, options)
    } catch (err) {
      if (err instanceof SearchError && (err.kind === 'rate-limited' || err.kind === 'auth')) throw err
      lastError = err
      if (attempt < retry) await sleep(1500)
    }
  }
  throw lastError
}
