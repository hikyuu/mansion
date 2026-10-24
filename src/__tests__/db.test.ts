import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DbError, read, write, WRITE_RETRIES, type DbRun } from '@/common/db'

const state = vi.hoisted(() => ({
  client: {} as unknown,
  authError: null as Error | null
}))

vi.mock('@/store/user-store', () => ({
  useUserStore: () => ({
    getAuthSupabase: async () => {
      if (state.authError) throw state.authError
      return state.client
    }
  })
}))

function fail(message: string) {
  return { data: null, error: { message } }
}

beforeEach(() => {
  state.authError = null
})

describe('read', () => {
  it('成功时返回 data', async () => {
    const run = vi.fn<DbRun<number>>(async () => ({ data: 7, error: null }))
    await expect(read(run)).resolves.toBe(7)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('出错抛 DbError，保留服务端 message', async () => {
    const run = vi.fn<DbRun<number>>(async () => fail('permission denied for table archive'))
    const error = await read(run).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(DbError)
    expect((error as DbError).message).toBe('permission denied for table archive')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('鉴权失败直接抛，不发起查询', async () => {
    state.authError = new Error('请先登录')
    const run = vi.fn<DbRun<number>>(async () => ({ data: 1, error: null }))

    await expect(read(run)).rejects.toThrow('请先登录')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('write', () => {
  it('首次成功不重试', async () => {
    const run = vi.fn<DbRun<number>>(async () => ({ data: 1, error: null }))
    await expect(write(run)).resolves.toBe(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('失败后重试直到成功', async () => {
    let calls = 0
    const run = vi.fn<DbRun<number>>(async () => {
      calls++
      return calls < 3 ? fail('transient') : { data: 9, error: null }
    })

    await expect(write(run)).resolves.toBe(9)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('重试耗尽抛 DbError，尝试次数 = 重试次数 + 1', async () => {
    const run = vi.fn<DbRun<number>>(async () => fail('still down'))

    await expect(write(run)).rejects.toThrow('still down')
    expect(run).toHaveBeenCalledTimes(WRITE_RETRIES + 1)
  })

  it('可覆盖重试次数', async () => {
    const run = vi.fn<DbRun<number>>(async () => fail('down'))

    await expect(write(run, 0)).rejects.toThrow('down')
    expect(run).toHaveBeenCalledTimes(1)
  })
})
