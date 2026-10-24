import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import type { RequestGetParams, SessionCreateParams, SessionDestroyParams, Solution } from 'flare-solverr'

// ========== 配置常量 ==========

/** FlareSolverr 服务地址 */
export const FLARESOLVERR_URL = 'http://192.168.31.1:8191/v1'

/** 默认会话 TTL（分钟）- FlareSolverr 到期自动销毁 Chrome 实例 */
export const DEFAULT_SESSION_TTL_MINUTES = 30

/** 请求超时（毫秒） */
export const REQUEST_TIMEOUT = 60000

/** GM_xmlhttpRequest 超时（毫秒）- 需稍长于 REQUEST_TIMEOUT */
export const GM_REQUEST_TIMEOUT = 65000

/** 500 错误最大重试次数 */
export const MAX_RETRY_ON_500 = 2

/** 重试退避基础间隔（毫秒） */
export const RETRY_BASE_DELAY = 1000

/** FlareSolverr 调用失败：文案里保留 HTTP 状态码，withRetry 依赖「状态码: 500」判定会话失效 */
export class FlareSolverrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlareSolverrError'
  }
}

// ========== 传输层 ==========

interface FlareEnvelope {
  status: 'ok' | 'error'
  message?: string
  session?: string
  sessions?: string[]
  solution?: Solution
}

/**
 * 唯一的 FlareSolverr 出口：POST 命令体 → 解析 → 校验 status。
 * 四个命令（request.get / sessions.create / sessions.destroy / sessions.list）
 * 只在请求体与取用字段上不同，失败分支完全一致。
 */
function postFlare(body: object, timeoutMs: number): Promise<FlareEnvelope> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url: FLARESOLVERR_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(body),
      timeout: timeoutMs,
      onload: (response) => {
        if (response.status !== 200) {
          reject(new FlareSolverrError(`FlareSolverr 请求失败，状态码: ${response.status}`))
          return
        }
        let json: FlareEnvelope
        try {
          json = JSON.parse(response.responseText) as FlareEnvelope
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          reject(new FlareSolverrError('解析 FlareSolverr 响应失败: ' + message))
          return
        }
        if (json.status !== 'ok') {
          reject(new FlareSolverrError(`FlareSolverr 处理失败: ${json.message ?? '未知错误'}`))
          return
        }
        resolve(json)
      },
      onerror: (error) => {
        // GM 的 onerror 给的是对象，直接拼字符串会得到 [object Object]
        const detail =
          error && typeof error === 'object' && 'error' in error
            ? String((error as { error: unknown }).error)
            : String(error)
        reject(
          new FlareSolverrError(
            `请求 FlareSolverr 服务出错，请确保服务已启动在 ${FLARESOLVERR_URL}。错误详情: ${detail}`
          )
        )
      },
      ontimeout: () => {
        reject(new FlareSolverrError(`请求 FlareSolverr 服务超时（${timeoutMs}ms）`))
      }
    })
  })
}

// ========== 核心 API ==========

/**
 * 请求 FlareSolverr 以获取绕过 Cloudflare 后的页面内容
 * @param targetUrl 目标 URL
 * @param sessionId 会话 ID
 * @param cookies 携带的 cookies
 * @param sessionTtlMinutes 可选，会话 TTL（分钟）
 */
export async function getFromFlareSolverr(
  targetUrl: string,
  sessionId: string,
  cookies: GmCallbackCookie[],
  sessionTtlMinutes?: number
): Promise<Solution> {
  const body: RequestGetParams = {
    cmd: 'request.get',
    url: targetUrl,
    session: sessionId,
    cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain })),
    maxTimeout: REQUEST_TIMEOUT
  }
  if (sessionTtlMinutes !== undefined) {
    body.session_ttl_minutes = sessionTtlMinutes
  }

  const response = await postFlare(body, GM_REQUEST_TIMEOUT)
  if (!response.solution) {
    throw new FlareSolverrError('FlareSolverr 返回成功但无 solution')
  }
  return response.solution
}

/**
 * 创建 FlareSolverr 会话
 * @param sessionId 可选的自定义会话 ID
 * @param sessionTtlMinutes 可选，会话 TTL（分钟），到期后 FlareSolverr 自动销毁
 */
export async function createSession(sessionId = '', sessionTtlMinutes?: number): Promise<string> {
  const postData: SessionCreateParams = { cmd: 'sessions.create' }
  if (sessionId) {
    postData.session = sessionId
  }
  if (sessionTtlMinutes !== undefined) {
    postData.session_ttl_minutes = sessionTtlMinutes
  }

  const response = await postFlare(postData, REQUEST_TIMEOUT)
  if (!response.session) {
    throw new FlareSolverrError('FlareSolverr 未返回 session')
  }
  console.log('FlareSolverr 会话创建成功! Session ID:', response.session)
  return response.session
}

/**
 * 销毁 FlareSolverr 会话（释放 Chrome 实例）。
 * 销毁失败不向上抛：会话本来就无效时，调用方也无事可做。
 */
export async function destroySession(sessionId: string): Promise<void> {
  const postData: SessionDestroyParams = { cmd: 'sessions.destroy', session: sessionId }
  try {
    await postFlare(postData, REQUEST_TIMEOUT)
    console.log('FlareSolverr 会话已销毁:', sessionId)
  } catch (error) {
    console.warn('销毁 FlareSolverr 会话失败:', error)
  }
}

/**
 * 列出 FlareSolverr 所有活跃会话
 */
export function listSessions(): Promise<string[]> {
  return postFlare({ cmd: 'sessions.list' }, REQUEST_TIMEOUT).then((response) => response.sessions ?? [])
}

// ========== 重试与健康检查 ==========

/**
 * 判断错误是否为 500（session 失效类错误）
 */
function isSessionInvalidError(e: unknown): boolean {
  if (e instanceof Error && e.message.includes('状态码: 500')) {
    return true
  }
  return false
}

/**
 * 带重试的请求包装器 - 500 错误时自动销毁旧 session 并重建重试
 * @param fn 核心请求函数，接收 sessionId，返回 Solution
 * @param sessionId 当前 session ID
 * @param createNewSession 创建新 session 的函数
 * @param destroyOldSession 销毁旧 session 的函数
 * @param maxRetries 最大重试次数
 */
export async function withRetry(
  fn: (sessionId: string) => Promise<Solution>,
  sessionId: string,
  createNewSession: () => Promise<string>,
  destroyOldSession: (sid: string) => Promise<void>,
  maxRetries: number = MAX_RETRY_ON_500
): Promise<{ solution: Solution; sessionId: string }> {
  let lastError: Error | null = null
  let currentSessionId = sessionId

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const solution = await fn(currentSessionId)
      return { solution, sessionId: currentSessionId }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))

      // 只有 500 类错误才触发重试 + 重建 session
      if (isSessionInvalidError(e) && attempt < maxRetries) {
        console.warn(`FlareSolverr 500 错误，销毁并重建 session (重试 ${attempt + 1}/${maxRetries})`)

        // 销毁旧的失效 session（静默）
        await destroyOldSession(currentSessionId).catch(() => {})

        // 创建新 session
        currentSessionId = await createNewSession()

        // 指数退避等待
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt)
        await new Promise((r) => setTimeout(r, delay))
        continue
      }

      // 非 500 错误或已达最大重试次数，直接抛出
      throw lastError
    }
  }

  throw lastError || new Error('withRetry 未知错误')
}

/**
 * 检查 session 是否仍在 FlareSolverr 端存活
 * @returns true 如果 session 在活跃列表中
 */
export async function ensureSessionAlive(sessionId: string): Promise<boolean> {
  try {
    const sessions = await listSessions()
    return sessions.includes(sessionId)
  } catch {
    // 列表查询失败时保守处理，认为 session 不可用
    return false
  }
}

// ========== 类型导出 ==========

export interface GmCallbackCookie {
  domain: string
  expirationDate?: number
  firstPartyDomain?: string
  hostOnly: boolean
  httpOnly: boolean
  name: string
  path: string
  sameSite: string
  secure: boolean
  session: boolean
  value: string
}
