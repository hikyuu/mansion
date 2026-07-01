import { GM_xmlhttpRequest, type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import type {
  FlareSolverrResponse,
  RequestGetParams,
  SessionCreateParams,
  SessionDestroyParams,
  SessionListResponse,
  SessionDestroyResponse,
  Solution
} from 'flare-solverr'

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

// ========== 核心 API ==========

/**
 * 请求 FlareSolverr 以获取绕过 Cloudflare 后的页面内容
 * @param targetUrl 目标 URL
 * @param sessionId 会话 ID
 * @param cookies 携带的 cookies
 * @param sessionTtlMinutes 可选，会话 TTL（分钟）
 */
export function getFromFlareSolverr(
  targetUrl: string,
  sessionId: string,
  cookies: GmCallbackCookie[],
  sessionTtlMinutes?: number
): Promise<Solution> {
  return new Promise((resolve, reject) => {
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

    GM_xmlhttpRequest({
      method: 'POST',
      url: FLARESOLVERR_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(body),
      onload: function (response) {
        if (response.status === 200) {
          try {
            const jsonResponse: FlareSolverrResponse = JSON.parse(response.responseText)
            if (jsonResponse.status === 'ok') {
              if (jsonResponse.solution) {
                resolve(jsonResponse.solution)
              } else {
                reject(new Error('FlareSolverr 返回成功但无 solution'))
              }
            } else {
              reject(new Error(`FlareSolverr 处理失败: ${jsonResponse.message}`))
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            reject(new Error('解析 FlareSolverr 响应失败: ' + msg))
          }
        } else {
          reject(new Error(`FlareSolverr 请求失败，状态码: ${response.status}`))
        }
      },
      onerror: function (error) {
        reject(new Error('请求 FlareSolverr 服务出错，请确保服务已启动在 ' + FLARESOLVERR_URL + '。错误详情: ' + error))
      },
      timeout: GM_REQUEST_TIMEOUT
    })
  })
}

/**
 * 创建 FlareSolverr 会话
 * @param sessionId 可选的自定义会话 ID
 * @param sessionTtlMinutes 可选，会话 TTL（分钟），到期后 FlareSolverr 自动销毁
 */
export function createSession(sessionId = '', sessionTtlMinutes?: number): Promise<string> {
  const postData: SessionCreateParams = {
    cmd: 'sessions.create'
  }
  if (sessionId) {
    postData.session = sessionId
  }
  if (sessionTtlMinutes !== undefined) {
    postData.session_ttl_minutes = sessionTtlMinutes
  }

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url: FLARESOLVERR_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(postData),
      timeout: REQUEST_TIMEOUT,
      onload: function (response) {
        resolve(handleSessionResponse(response))
      },
      onerror: function (error) {
        reject(new Error('创建 FlareSolverr 会话时发生网络错误:' + error))
      },
      ontimeout: function () {
        reject(new Error('创建 FlareSolverr 会话请求超时。'))
      }
    })
  })
}

/**
 * 销毁 FlareSolverr 会话（释放 Chrome 实例）
 */
export function destroySession(sessionId: string): Promise<void> {
  const postData: SessionDestroyParams = {
    cmd: 'sessions.destroy',
    session: sessionId
  }

  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      url: FLARESOLVERR_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(postData),
      timeout: REQUEST_TIMEOUT,
      onload: function (response) {
        if (response.status === 200) {
          try {
            const result: SessionDestroyResponse = JSON.parse(response.responseText)
            if (result.status === 'ok') {
              console.log('FlareSolverr 会话已销毁:', sessionId)
            } else {
              console.warn('FlareSolverr 销毁会话返回异常:', result.message)
            }
          } catch {
            // 解析失败静默处理
          }
        } else {
          console.warn('销毁 FlareSolverr 会话失败，状态码:', response.status)
        }
        resolve()
      },
      onerror: function () {
        // 网络错误静默处理
        resolve()
      },
      ontimeout: function () {
        resolve()
      }
    })
  })
}

/**
 * 列出 FlareSolverr 所有活跃会话
 */
export function listSessions(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url: FLARESOLVERR_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ cmd: 'sessions.list' }),
      timeout: REQUEST_TIMEOUT,
      onload: function (response) {
        if (response.status === 200) {
          try {
            const result: SessionListResponse = JSON.parse(response.responseText)
            if (result.status === 'ok') {
              resolve(result.sessions || [])
            } else {
              reject(new Error('FlareSolverr 列表查询失败:' + result.message))
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            reject(new Error('解析 FlareSolverr 列表响应失败: ' + msg))
          }
        } else {
          reject(new Error('查询 FlareSolverr 会话列表失败，状态码:' + response.status))
        }
      },
      onerror: function (error) {
        reject(new Error('查询 FlareSolverr 会话列表时发生网络错误:' + error))
      },
      ontimeout: function () {
        reject(new Error('查询 FlareSolverr 会话列表请求超时。'))
      }
    })
  })
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

// ========== 内部工具 ==========

function handleSessionResponse(response: GmResponseEvent<'text'>): string {
  if (response.status === 200) {
    try {
      const result = JSON.parse(response.responseText)
      if (result.status && result.status === 'ok') {
        const sessionId = result.session
        console.log('FlareSolverr 会话创建成功! Session ID:', sessionId)
        return sessionId
      } else {
        throw new Error('FlareSolverr 返回错误:' + result.message)
      }
    } catch (e) {
      throw new Error('解析 FlareSolverr 响应失败:' + e)
    }
  } else {
    throw new Error('请求失败，HTTP状态码:' + response.status)
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
