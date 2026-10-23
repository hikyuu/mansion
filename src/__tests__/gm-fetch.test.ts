import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import { gmFetch } from '@/download/gm-fetch.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  monkeyWindow: {}
}))

const gmMock = vi.mocked(GM_xmlhttpRequest)

function mockGmResponse(partial: { status?: number; statusText?: string; responseText?: string }) {
  gmMock.mockImplementation(((details: {
    onload?: (e: unknown) => void
  }) => {
    details.onload?.({
      status: partial.status ?? 200,
      statusText: partial.statusText ?? 'OK',
      responseText: partial.responseText ?? ''
    })
    return { abort: vi.fn<() => void>() }
  }) as unknown as typeof GM_xmlhttpRequest)
}

beforeEach(() => {
  gmMock.mockReset()
})

describe('gmFetch', () => {
  it('onload 成功：返回 ok/status/text() 最小面', async () => {
    mockGmResponse({ status: 200, responseText: '{"ok":true}' })
    const response = await gmFetch('http://127.0.0.1:6427/api/v1/health', { method: 'GET' })
    expect(response.ok).toBe(true)
    expect(response.status).toBe(200)
    await expect(response.text()).resolves.toBe('{"ok":true}')
  })

  it('HTTP 错误状态：ok=false 但仍然 resolve（错误体由调用方解析）', async () => {
    mockGmResponse({
      status: 502,
      statusText: 'Bad Gateway',
      responseText: '{"error":{"code":"THUNDER_UNAVAILABLE"}}'
    })
    const response = await gmFetch('http://127.0.0.1:6427/api/v1/health')
    expect(response.ok).toBe(false)
    expect(response.status).toBe(502)
    await expect(response.text()).resolves.toContain('THUNDER_UNAVAILABLE')
  })

  it('请求参数透传：method / headers / data', async () => {
    mockGmResponse({ status: 200 })
    await gmFetch('http://127.0.0.1:6427/api/v1/thunder/tasks/video', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
      body: '{"magnet":"magnet:?xt=urn:btih:a"}'
    })
    expect(gmMock).toHaveBeenCalledTimes(1)
    const details = gmMock.mock.calls[0]?.[0] as {
      url: string
      method: string
      headers: Record<string, string>
      data: unknown
    }
    expect(details.url).toBe('http://127.0.0.1:6427/api/v1/thunder/tasks/video')
    expect(details.method).toBe('POST')
    expect(details.headers).toMatchObject({ 'content-type': 'application/json', authorization: 'Bearer t' })
    expect(details.data).toBe('{"magnet":"magnet:?xt=urn:btih:a"}')
  })

  it('GM 网络错误：reject 普通 Error', async () => {
    gmMock.mockImplementation(((details: { onerror?: (e: unknown) => void }) => {
      details.onerror?.({ error: 'net::ERR_CONNECTION_REFUSED' })
      return { abort: vi.fn<() => void>() }
    }) as unknown as typeof GM_xmlhttpRequest)
    await expect(gmFetch('http://127.0.0.1:6427/api/v1/health')).rejects.toThrow(/net::ERR_CONNECTION_REFUSED/)
  })

  it('signal 中止：reject AbortError 且调用 GM abort', async () => {
    const abortFn = vi.fn<() => void>()
    gmMock.mockImplementation((() => ({ abort: abortFn })) as unknown as typeof GM_xmlhttpRequest)
    const controller = new AbortController()
    const promise = gmFetch('http://127.0.0.1:6427/api/v1/health', { signal: controller.signal })
    controller.abort()
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AbortError')
    expect(abortFn).toHaveBeenCalledTimes(1)
  })

  it('signal 已中止：立即 reject AbortError，不再发请求', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await gmFetch('http://127.0.0.1:6427/api/v1/health', { signal: controller.signal }).catch(
      (e: unknown) => e
    )
    expect((error as Error).name).toBe('AbortError')
    expect(gmMock).not.toHaveBeenCalled()
  })
})
