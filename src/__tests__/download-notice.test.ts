import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElNotification } from 'element-plus'
import type { DownloadSubmitResult } from '@/download'
import {
  formatDownloadChannel,
  formatDownloadNotice,
  formatDownloadSource,
  notifyDownload,
  resolveNoticeType
} from '@/download/notice.ts'

vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))

const NOTIFY_MOCK = vi.mocked(ElNotification)

function result(overrides: Partial<DownloadSubmitResult> = {}): DownloadSubmitResult {
  return {
    ok: true,
    channel: 'miao',
    fellBack: false,
    outcome: 'created',
    message: '已添加任务 #12',
    ...overrides
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('来源文案', () => {
  it('无 note 只显示 label', () => {
    expect(formatDownloadSource({ label: 'javdb 高分磁力' })).toBe('javdb 高分磁力')
  })

  it('有 note 时括号补充', () => {
    expect(formatDownloadSource({ label: 'onejav 种子', note: 'javdb 未命中：没有找到磁力链接' })).toBe(
      'onejav 种子（javdb 未命中：没有找到磁力链接）'
    )
  })

  it('缺来源时兜底「未知来源」', () => {
    expect(formatDownloadSource()).toBe('未知来源')
  })
})

describe('通道文案', () => {
  it('未回退只显示通道名', () => {
    expect(formatDownloadChannel(result({ channel: 'miao' }))).toBe('miao')
    expect(formatDownloadChannel(result({ channel: 'copy' }))).toBe('剪贴板')
  })

  it('回退迅雷时带上 miao 侧原因', () => {
    expect(
      formatDownloadChannel(
        result({ channel: 'thunder', fellBack: true, fallbackReason: '无法连接 miao 服务' })
      )
    ).toBe('迅雷（miao 回退：无法连接 miao 服务）')
  })

  it('回退但没原因时只标记回退', () => {
    expect(formatDownloadChannel(result({ channel: 'thunder', fellBack: true }))).toBe('迅雷（miao 回退）')
  })
})

describe('结局 → 通知类型', () => {
  it('成功 success', () => {
    expect(resolveNoticeType(result())).toBe('success')
  })

  it('回退成功 warning', () => {
    expect(resolveNoticeType(result({ channel: 'thunder', fellBack: true }))).toBe('warning')
  })

  it('用户取消 info', () => {
    expect(resolveNoticeType(result({ ok: false, outcome: 'cancelled', message: '已取消文件选择' }))).toBe('info')
  })

  it('失败 error', () => {
    expect(resolveNoticeType(result({ ok: false, outcome: 'failed', message: '迅雷协议建任务失败' }))).toBe('error')
  })
})

describe('完整文案', () => {
  it('javdb 磁力 → miao', () => {
    expect(
      formatDownloadNotice({ title: 'ABC-123', source: { label: 'javdb 高分磁力' }, result: result() })
    ).toEqual({ type: 'success', message: 'javdb 高分磁力 → miao：已添加任务 #12' })
  })

  it('onejav 种子回退 + miao 回退迅雷', () => {
    const notice = formatDownloadNotice({
      title: 'ABC-123',
      source: { label: 'onejav 种子', note: 'javdb 未命中：没有找到高分磁力链接' },
      result: result({
        channel: 'thunder',
        fellBack: true,
        fallbackReason: '无法连接 miao 服务',
        message: '已添加任务'
      })
    })
    expect(notice.type).toBe('warning')
    expect(notice.message).toBe(
      'onejav 种子（javdb 未命中：没有找到高分磁力链接） → 迅雷（miao 回退：无法连接 miao 服务）：已添加任务'
    )
  })
})

describe('notifyDownload', () => {
  it('标题用番号，正文用统一格式', () => {
    notifyDownload({
      title: 'ABC-123',
      source: { label: 'javdb 磁力' },
      result: result({ channel: 'copy', message: '已复制下载链接' })
    })

    expect(NOTIFY_MOCK).toHaveBeenCalledWith({
      title: 'ABC-123',
      message: 'javdb 磁力 → 剪贴板：已复制下载链接',
      type: 'success'
    })
  })
})
