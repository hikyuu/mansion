import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'

/**
 * GM_xmlhttpRequest → fetch 形状适配器，注入 ThunderClient 的 options.fetch。
 *
 * miao REST 服务不返回 CORS 头，网页环境直接 fetch 跨源会被同源策略拦截；
 * GM_xmlhttpRequest 是油猴特权接口（connect 权限含 *），可直连 127.0.0.1:6427。
 * 只实现 ThunderClient 实际用到的最小面：
 * - 请求侧：method / headers / body / signal
 * - 响应侧：ok / status / text()
 *
 * abort 语义：signal 触发或 GM 级 abort 时 reject，且 error.name === 'AbortError'，
 * 否则 ThunderClient 的超时归因会失真（它按 name === 'AbortError' 区分超时与连接失败）。
 */
export const gmFetch: typeof globalThis.fetch = (input, init) => {
  return new Promise<Response>((resolve, reject) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = normalizeHeaders(init?.headers)
    const data = init?.body ?? undefined

    let settled = false

    function succeed(response: Response): void {
      if (settled) return
      settled = true
      init?.signal?.removeEventListener('abort', onAbort)
      resolve(response)
    }

    function fail(error: Error): void {
      if (settled) return
      settled = true
      init?.signal?.removeEventListener('abort', onAbort)
      reject(error)
    }

    function onAbort(): void {
      if (settled) return
      // 先标记 settled 再 abort，避免 GM 的 onabort 回调二次结算
      settled = true
      init?.signal?.removeEventListener('abort', onAbort)
      abortHandle.abort()
      reject(abortError())
    }

    const signal = init?.signal
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    // 先拿到 abort 句柄再挂监听：监听一旦触发就会调 abort()，句柄必须已就绪
    const abortHandle = GM_xmlhttpRequest({
      url,
      method,
      headers,
      data,
      responseType: 'text',
      onload: (res) => {
        succeed({
          ok: res.status >= 200 && res.status < 300,
          status: res.status,
          statusText: res.statusText,
          text: () => Promise.resolve(res.responseText)
        } as Response)
      },
      onerror: (err) => {
        fail(new Error(err.error || `无法连接服务：${method} ${url}`))
      },
      ontimeout: () => {
        fail(new Error(`请求超时：${method} ${url}`))
      },
      onabort: () => {
        fail(abortError())
      }
    })

    signal?.addEventListener('abort', onAbort)
  })
}

function abortError(): Error {
  const error = new Error('请求已中止')
  error.name = 'AbortError'
  return error
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value
    })
    return result
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      result[entry[0]] = entry[1]
    }
    return result
  }
  return { ...headers }
}
