import { describe, expect, it } from 'vitest'
import { CloudflareBlockedError, detectCloudflareBlock } from '@/common/cloudflare'

describe('detectCloudflareBlock · 挑战页', () => {
  it('响应头带 cf-mitigated: challenge 即判定为挑战页', () => {
    const block = detectCloudflareBlock({
      status: 403,
      responseHeaders: 'server: cloudflare\r\ncf-mitigated: challenge\r\ncf-ray: 8f2a1c3b4d5e6f70-SJC'
    })

    expect(block).toMatchObject({ kind: 'challenge', status: 403, rayId: '8f2a1c3b4d5e6f70' })
  })

  it('页面是 Just a moment... 挑战页时判定为挑战页', () => {
    const block = detectCloudflareBlock({
      status: 200,
      responseHeaders: 'server: cloudflare',
      body: '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>'
    })

    expect(block).toMatchObject({ kind: 'challenge', status: 200 })
  })
})

describe('detectCloudflareBlock · 封禁与限流', () => {
  it('403 + cf-ray 判定为封禁，Ray ID 去掉机房后缀', () => {
    const block = detectCloudflareBlock({
      status: 403,
      responseHeaders: 'server: cloudflare\ncf-ray: 8f2a1c3b4d5e6f70-SJC'
    })

    expect(block).toMatchObject({ kind: 'blocked', status: 403, rayId: '8f2a1c3b4d5e6f70' })
  })

  it('1015 限流页判定为限流', () => {
    const block = detectCloudflareBlock({
      status: 429,
      body: '<html><body><h1>Access denied</h1><p>error code: 1015</p></body></html>'
    })

    expect(block).toMatchObject({ kind: 'rate-limited', status: 429 })
  })

  it('封禁页文案命中时判定为封禁', () => {
    const block = detectCloudflareBlock({
      status: 403,
      body: '<html><head><title>Attention Required! | Cloudflare</title></head></html>'
    })

    expect(block).toMatchObject({ kind: 'blocked', status: 403 })
  })
})

describe('detectCloudflareBlock · 不误判', () => {
  it('404 无 CF 信号不判为拦截（链接失效不是拦截）', () => {
    expect(
      detectCloudflareBlock({
        status: 404,
        responseHeaders: 'server: nginx',
        body: '<html><body>404 Not Found</body></html>'
      })
    ).toBeNull()
  })

  it('正常业务 HTML 不判为拦截', () => {
    expect(
      detectCloudflareBlock({
        status: 200,
        responseHeaders: 'server: cloudflare\ncf-ray: 8f2a1c3b4d5e6f70-SJC',
        body: '<html><body><a title="Download .torrent" href="/x.torrent">x</a></body></html>'
      })
    ).toBeNull()
  })

  it('种子二进制（bencode 顶层字典）不判为拦截，即使片段里出现 CF 文案', () => {
    expect(
      detectCloudflareBlock({
        status: 200,
        responseHeaders: 'server: cloudflare',
        body: 'd8:announce30:http://tracker/just a moment14:cf-error-details'
      })
    ).toBeNull()
  })

  it('200 空响应不判为拦截', () => {
    expect(detectCloudflareBlock({ status: 200 })).toBeNull()
  })
})

describe('CloudflareBlockedError', () => {
  it('文案带站点、形态与 Ray ID，可直接作为通知备注', () => {
    const error = new CloudflareBlockedError('onejav', {
      kind: 'challenge',
      status: 403,
      rayId: '8f2a1c3b4d5e6f70',
      evidence: '页面特征 just a moment'
    })

    expect(error.message).toBe('onejav 被 Cloudflare 拦截（挑战页，Ray 8f2a1c3b4d5e6f70）')
    expect(error).toBeInstanceOf(Error)
    expect(error.block.kind).toBe('challenge')
  })

  it('带兜底原因时追加在文案末尾', () => {
    const error = new CloudflareBlockedError(
      'onejav',
      { kind: 'blocked', status: 403, evidence: '响应头 cf-ray + 状态码 403' },
      'FlareSolverr 兜底未成功：请求超时'
    )

    expect(error.message).toBe('onejav 被 Cloudflare 拦截（访问封禁），FlareSolverr 兜底未成功：请求超时')
  })
})
