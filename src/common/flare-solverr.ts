import { GM_xmlhttpRequest, type GmResponseEvent } from 'vite-plugin-monkey/dist/client'
import type { FlareSolverrResponse, RequestGetParams, SessionCreateParams, Solution } from 'flare-solverr'

// 配置信息
const FLARESOLVERR_URL = 'http://192.168.31.1:8191/v1'

/**
 * 第一步：请求 FlareSolverr 以获取绕过 Cloudflare 后的 Cookie
 */
export function getFromFlareSolverr(
  targetUrl: string,
  sessionId: string,
  cookies: GmCallbackCookie[]
): Promise<Solution> {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'POST',
      url: FLARESOLVERR_URL,
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify({
        cmd: 'request.get',
        url: targetUrl,
        session: sessionId,
        cookies: cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain })),
        maxTimeout: 60000 // 超时时间（毫秒）
      } as RequestGetParams),
      onload: function (response) {
        if (response.status === 200) {
          try {
            const jsonResponse: FlareSolverrResponse = JSON.parse(response.responseText)
            if (jsonResponse.status === 'ok') {
              if (jsonResponse.solution) {
                resolve(jsonResponse.solution)
              }
            } else {
              reject(new Error(`FlareSolverr 处理失败: ${jsonResponse.message}`))
            }
          } catch (e) {
            if (e instanceof Error) {
              reject(new Error('解析 FlareSolverr 响应失败: ' + e.message))
            } else {
              reject(new Error('解析 FlareSolverr 响应失败，非 Error 类型: ' + e))
            }
          }
        } else {
          reject(new Error(`FlareSolverr 请求失败，状态码: ${response.status}`))
        }
      },
      onerror: function (error) {
        reject(new Error('请求 FlareSolverr 服务出错，请确保服务已启动在 ' + FLARESOLVERR_URL + '。错误详情: ' + error))
      },
      timeout: 65000 // GM_xmlhttpRequest 的超时应稍长于 FlareSolverr 的 maxTimeout
    })
  })
}

export function createSession(sessionId = ''): Promise<string> {
  // 构建发送给 FlareSolverr 的请求数据
  const postData = {
    cmd: 'sessions.create'
  } as SessionCreateParams

  // 如果指定了会话ID，则添加到请求参数中
  if (sessionId) {
    postData.session = sessionId
  }
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url: FLARESOLVERR_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(postData), // 将数据对象转换为JSON字符串
      timeout: 60000, // 超时时间设置为60秒
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

function handleSessionResponse(response: GmResponseEvent<'text'>) {
  if (response.status === 200) {
    try {
      const result = JSON.parse(response.responseText)
      // 检查响应状态是否为 "ok"
      if (result.status && result.status === 'ok') {
        const sessionId = result.session
        console.log('FlareSolverr 会话创建成功! Session ID:', sessionId)
        // 在这里可以将会话ID存储到变量或GM_setValue中，供后续请求使用
        // 例如：使用 sessionId 进行后续的 request.get 操作 [1](@ref)
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
