import { beforeEach, describe, expect, it, vi } from 'vitest'
import { download, type DownloadSubmitResult } from '@/download'
import { haveArchived, upsertArchive } from '@/dao/archive'
import { activeDownloads, submitDownload } from '@/download/intent'

vi.mock('@/download', () => ({ download: vi.fn<(url: string) => Promise<DownloadSubmitResult>>() }))
vi.mock('@/dao/archive', () => ({
  haveArchived: vi.fn<(serialNumber: string) => Promise<boolean>>(),
  upsertArchive: vi.fn<(serialNumber: string) => Promise<unknown>>()
}))
vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))

const downloadMock = vi.mocked(download)
const haveArchivedMock = vi.mocked(haveArchived)
const upsertArchiveMock = vi.mocked(upsertArchive)

const MAGNET = 'magnet:?xt=urn:btih:624ed719aaf2205a5c7b4c72a6a0c97e7f66b0e2'
const SERIAL = 'ABC-123'

function submitResult(overrides: Partial<DownloadSubmitResult> = {}): DownloadSubmitResult {
  return { ok: true, channel: 'miao', fellBack: false, message: '已添加 miao 任务', ...overrides }
}

beforeEach(() => {
  vi.resetAllMocks()
  haveArchivedMock.mockResolvedValue(false)
  downloadMock.mockResolvedValue(submitResult())
})

describe('submitDownload 结局', () => {
  it('没有选中 → failed，不解析也不提交', async () => {
    const resolveSource = vi.fn<() => Promise<string>>(async () => MAGNET)
    const result = await submitDownload({ checkArchive: true, resolveSource })

    expect(result.status).toBe('failed')
    expect(result.message).toBe('没有选中')
    expect(resolveSource).not.toHaveBeenCalled()
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('判档命中 → skipped，不解析不提交不记账', async () => {
    haveArchivedMock.mockResolvedValue(true)
    const resolveSource = vi.fn<() => Promise<string>>(async () => MAGNET)
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource })

    expect(result.status).toBe('skipped')
    expect(resolveSource).not.toHaveBeenCalled()
    expect(downloadMock).not.toHaveBeenCalled()
    expect(upsertArchiveMock).not.toHaveBeenCalled()
  })

  it('Alt 跳过判档 → 不查归档，照常提交', async () => {
    haveArchivedMock.mockResolvedValue(true)
    const result = await submitDownload({
      serialNumber: SERIAL,
      checkArchive: false,
      resolveSource: async () => MAGNET
    })

    expect(haveArchivedMock).not.toHaveBeenCalled()
    expect(result.status).toBe('submitted')
  })

  it('解析返回 null → failed，不提交不记账', async () => {
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => null })

    expect(result.status).toBe('failed')
    expect(result.message).toBe('没有找到下载地址')
    expect(downloadMock).not.toHaveBeenCalled()
    expect(upsertArchiveMock).not.toHaveBeenCalled()
  })

  it('解析抛 Error → failed 且透出原因', async () => {
    const result = await submitDownload({
      serialNumber: SERIAL,
      checkArchive: true,
      resolveSource: async () => {
        throw new Error('没有找到详情页')
      }
    })

    expect(result).toMatchObject({ status: 'failed', message: '没有找到详情页' })
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('解析抛非 Error（javdb-api 的 reject 字符串）→ String 兜底', async () => {
    const result = await submitDownload({
      serialNumber: SERIAL,
      checkArchive: true,
      resolveSource: async () => {
        throw '没有找到高分磁力链接'
      }
    })

    expect(result).toMatchObject({ status: 'failed', message: '没有找到高分磁力链接' })
  })

  it('同一番号在途 → blocked，第二次不解析不提交', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const first = submitDownload({
      serialNumber: SERIAL,
      checkArchive: false,
      resolveSource: async () => {
        await gate
        return MAGNET
      }
    })
    expect(activeDownloads.value).toContain(SERIAL)

    const second = await submitDownload({
      serialNumber: SERIAL,
      checkArchive: false,
      resolveSource: async () => MAGNET
    })
    expect(second.status).toBe('blocked')

    release()
    await expect(first).resolves.toMatchObject({ status: 'submitted' })
    expect(activeDownloads.value).toEqual([])
  })
})

describe('记账口径：交付才写归档', () => {
  it('miao 提交成功 → 记账', async () => {
    downloadMock.mockResolvedValue(submitResult({ channel: 'miao' }))
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(result.status).toBe('submitted')
    expect(upsertArchiveMock).toHaveBeenCalledWith(SERIAL)
  })

  it('迅雷提交成功 → 记账', async () => {
    downloadMock.mockResolvedValue(submitResult({ channel: 'thunder' }))
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(result.status).toBe('submitted')
    expect(upsertArchiveMock).toHaveBeenCalledWith(SERIAL)
  })

  it('复制成功（乐观值）→ 不记账', async () => {
    downloadMock.mockResolvedValue(submitResult({ channel: 'copy', message: '已复制下载链接到剪贴板' }))
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(result.status).toBe('submitted')
    expect(upsertArchiveMock).not.toHaveBeenCalled()
  })

  it('提交失败 → failed 且不记账', async () => {
    downloadMock.mockResolvedValue(submitResult({ ok: false, message: '迅雷下载失败' }))
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(result).toMatchObject({ status: 'failed', message: '迅雷下载失败' })
    expect(upsertArchiveMock).not.toHaveBeenCalled()
  })

  it('提交失败后番号不在途（守卫已释放）', async () => {
    downloadMock.mockResolvedValue(submitResult({ ok: false }))
    await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(activeDownloads.value).toEqual([])
  })
})

describe('数据访问失败的降级', () => {
  it('判档异常时按未归档继续，不阻塞下载', async () => {
    haveArchivedMock.mockRejectedValueOnce(new Error('db down'))
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(result.status).toBe('submitted')
    expect(upsertArchiveMock).toHaveBeenCalledWith(SERIAL)
  })

  it('归档写入异常不影响 submitted', async () => {
    upsertArchiveMock.mockRejectedValueOnce(new Error('db down'))
    const result = await submitDownload({ serialNumber: SERIAL, checkArchive: true, resolveSource: async () => MAGNET })

    expect(result.status).toBe('submitted')
  })
})
