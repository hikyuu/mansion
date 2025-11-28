declare module 'flare-solverr' {
  export interface FlareSolverrResponse {
    /**
     * Response status
     * - "ok": Successful response with solution
     * - "error": Error occurred during processing
     */
    status: 'ok' | 'error'

    /**
     * Human-readable message (error description or status information)
     */
    message: string

    /**
     * Unix timestamp (ms) when the request started
     */
    startTimestamp: number

    /**
     * Unix timestamp (ms) when the request finished
     */
    endTimestamp: number

    /**
     * FlareSolverr version string
     * Example: "v3.0.0"
     */
    version: string

    /**
     * Solution object (present when status = "ok")
     */
    solution?: Solution

    /**
     * Error details (present when status = "error")
     */
    error?: string
  }

  export interface Solution {
    /**
     * Final URL after redirects
     */
    url: string

    /**
     * HTTP status code
     * Example: 200
     */
    status: number

    /**
     * Response headers (key-value pairs)
     */
    headers: Record<string, string>

    /**
     * Cookies from the response (key-value pairs)
     */
    cookies: Record<string, string>

    /**
     * User agent used in the request
     */
    userAgent: string

    /**
     * HTML content of the page (if contentType is text/html)
     */
    response?: string

    /**
     * Raw response body (for non-HTML content)
     */
    rawResponse?: Buffer | string

    /**
     * Screenshot as base64 string (if requested)
     */
    screenshot?: string
  }

  interface BaseRequest {
    cmd: Command
    maxTimeout?: number
    session?: string
  }

  // GET请求参数
  export interface RequestGetParams extends BaseRequest {
    cmd: 'request.get'
    url: string
    returnOnlyCookies?: boolean
    userAgent?: string
    cookies?: Array<{
      name: string
      value: string
      domain?: string
      path?: string
      expires?: number
      httpOnly?: boolean
      secure?: boolean
    }>
  }

  // POST请求参数
  export interface RequestPostParams extends BaseRequest {
    cmd: 'request.post'
    url: string
    postData: string // application/x-www-form-urlencoded 格式
    returnOnlyCookies?: boolean
    userAgent?: string
  }

  // 会话管理参数
  export interface SessionCreateParams extends BaseRequest {
    cmd: 'sessions.create'
  }
}
