import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client'
import {
  createSession,
  destroySession,
  getFromFlareSolverr,
  GM_REQUEST_TIMEOUT,
  listSessions,
  REQUEST_TIMEOUT
} from '@/common/flare-solverr'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>()
}))

interface GmDetails {
  url: string
  method: string
  data: string
  timeout: number
  onload: (res: { status: number; responseText: string }) => void
  onerror: (error: unknown) => void
  ontimeout: () => void
}

const gmMock = vi.mocked(GM_xmlhttpRequest)

function mockPost(handler: (details: GmDetails) => void): void {
  gmMock.mockImplementation(((details: GmDetails) => {
    handler(details)
    return { abort: vi.fn<() => void>() }
  }) as unknown as typeof GM_xmlhttpRequest)
}

function respondJson(body: Record<string, unknown>): void {
  mockPost((details) => details.onload({ status: 200, responseText: JSON.stringify(body) }))
}

function lastDetails(): GmDetails {
  const call = gmMock.mock.calls.at(-1)
  expect(call).toBeDefined()
  return call![0] as GmDetails
}

function lastBody(): Record<string, unknown> {
  return JSON.parse(lastDetails().data) as Record<string, unknown>
}

beforeEach(() => {
  gmMock.mockReset()
})

describe('getFromFlareSolverr', () => {
  it('成功时返回 solution，并带上会话与 cookies', async () => {
    respondJson({ status: 'ok', solution: { response: '<html>ok</html>' } })

    const solution = await getFromFlareSolverr('https://javdb.com/search?q=abc', 'sid', [
      { name: 'cf_clearance', value: 'v', domain: 'javdb.com' } as never
    ])

    expect(solution).toEqual({ response: '<html>ok</html>' })
    const body = lastBody()
    expect(body.cmd).toBe('request.get')
    expect(body.url).toBe('https://javdb.com/search?q=abc')
    expect(body.session).toBe('sid')
    expect(lastDetails().timeout).toBe(GM_REQUEST_TIMEOUT)
  })

  it('成功但缺 solution → 抛错', async () => {
    respondJson({ status: 'ok' })
    await expect(getFromFlareSolverr('https://x', 'sid', [])).rejects.toThrow('无 solution')
  })

  it('服务端 status=error → 透出服务端 message', async () => {
    respondJson({ status: 'error', message: 'Challenge not solved' })
    await expect(getFromFlareSolverr('https://x', 'sid', [])).rejects.toThrow('Challenge not solved')
  })

  it('HTTP 500 的文案保留「状态码: 500」，withRetry 依赖该判据', async () => {
    mockPost((details) => details.onload({ status: 500, responseText: '' }))

    const error = await getFromFlareSolverr('https://x', 'sid', []).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('状态码: 500')
  })

  it('响应不是 JSON → 抛解析错误', async () => {
    mockPost((details) => details.onload({ status: 200, responseText: 'not json' }))
    await expect(getFromFlareSolverr('https://x', 'sid', [])).rejects.toThrow('解析 FlareSolverr 响应失败')
  })

  it('网络错误 → 提示服务地址', async () => {
    mockPost((details) => details.onerror({ error: 'ECONNREFUSED' }))
    await expect(getFromFlareSolverr('https://x', 'sid', [])).rejects.toThrow('ECONNREFUSED')
  })
})

describe('createSession', () => {
  it('返回会话 ID，超时用 REQUEST_TIMEOUT', async () => {
    respondJson({ status: 'ok', session: 'new-session' })

    await expect(createSession()).resolves.toBe('new-session')
    expect(lastBody()).toEqual({ cmd: 'sessions.create' })
    expect(lastDetails().timeout).toBe(REQUEST_TIMEOUT)
  })

  it('带 TTL 时写进请求体', async () => {
    respondJson({ status: 'ok', session: 's' })

    await createSession('', 30)

    expect(lastBody()).toEqual({ cmd: 'sessions.create', session_ttl_minutes: 30 })
  })

  it('未返回 session → 抛错', async () => {
    respondJson({ status: 'ok' })
    await expect(createSession()).rejects.toThrow('未返回 session')
  })
})

describe('destroySession', () => {
  it('成功时静默结束', async () => {
    respondJson({ status: 'ok' })

    await expect(destroySession('sid')).resolves.toBeUndefined()
    expect(lastBody()).toEqual({ cmd: 'sessions.destroy', session: 'sid' })
  })

  it('销毁失败不向上抛', async () => {
    mockPost((details) => details.onerror({ error: 'boom' }))
    await expect(destroySession('sid')).resolves.toBeUndefined()
  })
})

describe('listSessions', () => {
  it('返回活跃会话列表', async () => {
    respondJson({ status: 'ok', sessions: ['a', 'b'] })
    await expect(listSessions()).resolves.toEqual(['a', 'b'])
  })

  it('缺字段时返回空数组', async () => {
    respondJson({ status: 'ok' })
    await expect(listSessions()).resolves.toEqual([])
  })
})
