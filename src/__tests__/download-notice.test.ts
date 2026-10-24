import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElNotification } from 'element-plus'
import type { DownloadSubmitResult } from '@/download'
import {
  buildDownloadNoticeModel,
  formatDownloadChannel,
  formatDownloadNotice,
  formatDownloadSource,
  notifyDownload,
  notifyIntent,
  renderDownloadNotice,
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

function lastOptions(): Record<string, unknown> | undefined {
  return NOTIFY_MOCK.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

/** 递归收集 VNode 里的文本节点，用来断言用户真正看到的字 */
function collectText(node: unknown): string {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(collectText).join('')
  return collectText((node as { children?: unknown }).children)
}

function renderLastNotice(): string {
  const message = lastOptions()?.message
  return collectText(typeof message === 'function' ? (message as () => unknown)() : message)
}

function collectClasses(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(collectClasses)
  const vnode = node as { props?: { class?: unknown }; children?: unknown }
  const own = typeof vnode.props?.class === 'string' ? vnode.props.class.split(/\s+/) : []
  return [...own, ...collectClasses(vnode.children)]
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
      formatDownloadChannel(result({ channel: 'thunder', fellBack: true, fallbackReason: '无法连接 miao 服务' }))
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

describe('纯文本口径（日志 / 单行摘要）', () => {
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

describe('渲染模型：四层结构', () => {
  it('成功：番号 + 已投递 + 来源 → 通道 + 结局', () => {
    const model = buildDownloadNoticeModel({
      title: 'ABC-123',
      source: { label: 'javdb 高分磁力' },
      result: result()
    })

    expect(model).toEqual({
      title: 'ABC-123',
      type: 'success',
      statusText: '已投递',
      source: 'javdb 高分磁力',
      sourceOrigin: 'javdb',
      channel: 'miao',
      notes: [],
      outcome: '已添加任务 #12'
    })
  })

  it('来源身份：显式 origin 优先，缺省按 label 推断', () => {
    expect(
      buildDownloadNoticeModel({ title: 'ABC-123', source: { label: 'onejav 种子' }, result: result() }).sourceOrigin
    ).toBe('onejav')
    expect(
      buildDownloadNoticeModel({
        title: 'ABC-123',
        source: { label: '自定义来源', origin: 'exhentai' },
        result: result()
      }).sourceOrigin
    ).toBe('exhentai')
  })

  it('回退：来源未命中与 miao 回退原因拆成两条诊断行', () => {
    const model = buildDownloadNoticeModel({
      title: 'ABC-123',
      source: { label: 'onejav 种子', note: 'javdb 未命中：没有找到高分磁力链接' },
      result: result({
        channel: 'thunder',
        fellBack: true,
        fallbackReason: '无法连接 miao 服务',
        message: '已添加任务'
      })
    })

    expect(model.statusText).toBe('已回退')
    expect(model.channel).toBe('迅雷')
    expect(model.notes).toEqual(['javdb 未命中：没有找到高分磁力链接', 'miao 回退：无法连接 miao 服务'])
  })

  it('取消：状态词「已取消」，没有诊断行', () => {
    const model = buildDownloadNoticeModel({
      title: 'ABC-123',
      result: result({ ok: false, outcome: 'cancelled', message: '已取消文件选择' })
    })

    expect(model.type).toBe('info')
    expect(model.statusText).toBe('已取消')
    expect(model.notes).toEqual([])
  })

  it('缺来源时兜底「未知来源」与中性身份色', () => {
    const model = buildDownloadNoticeModel({ title: 'ABC-123', result: result() })
    expect(model.source).toBe('未知来源')
    expect(model.sourceOrigin).toBe('unknown')
  })
})

describe('VNode 渲染', () => {
  it('只渲染文本节点，外部文案不会被当成 HTML', () => {
    const vnode = renderDownloadNotice(
      buildDownloadNoticeModel({
        title: '<img src=x onerror=alert(1)>',
        source: { label: 'javdb 高分磁力' },
        result: result()
      })
    )

    expect(collectText(vnode)).toContain('<img src=x onerror=alert(1)>')
  })

  it('状态词、字段与结局都在文本里', () => {
    const text = collectText(
      renderDownloadNotice(
        buildDownloadNoticeModel({
          title: 'ABC-123',
          source: { label: 'javdb 高分磁力' },
          result: result()
        })
      )
    )

    expect(text).toContain('ABC-123')
    expect(text).toContain('已投递')
    expect(text).toContain('javdb 高分磁力')
    expect(text).toContain('来源')
    expect(text).toContain('通道')
    expect(text).toContain('结果')
    expect(text).toContain('miao')
    expect(text).toContain('已添加任务 #12')
  })

  it('结构化字段表：通道是独立徽章，备注按条堆叠', () => {
    const vnode = renderDownloadNotice(
      buildDownloadNoticeModel({
        title: 'ABC-123',
        source: { label: 'onejav 种子', note: 'javdb 未命中：没有找到高分磁力链接' },
        result: result({ channel: 'thunder', fellBack: true, fallbackReason: '无法连接 miao 服务', message: '已添加任务' })
      })
    )

    const classes = collectClasses(vnode)
    expect(classes).toContain('mansion-dn__fields')
    expect(classes).toContain('mansion-dn__label')
    expect(classes).toContain('mansion-dn__source')
    expect(classes).toContain('mansion-dn__origin--onejav')
    expect(classes).toContain('mansion-dn__channel')
    expect(classes).toContain('mansion-dn__notes')
    expect(classes).toContain('mansion-dn__note')
    // 备注只占一行 label，多条原因在值列内堆叠
    expect(collectText(vnode).match(/备注/g)).toHaveLength(1)
  })

  it('前置结局没有通道时省掉来源与通道行，只留结果', () => {
    notifyIntent({ title: 'ABC-123', type: 'info', statusText: '已取消', detail: '已取消文件选择' })

    const text = renderLastNotice()
    expect(text).toContain('结果')
    expect(text).not.toContain('来源')
    expect(text).not.toContain('通道')
  })
})

describe('notifyDownload：一次下载一条回执', () => {
  it('成功：success 配色，3.2 秒后让位', () => {
    notifyDownload({
      title: 'ABC-123',
      source: { label: 'javdb 磁力' },
      result: result({ channel: 'copy', message: '已复制下载链接' })
    })

    expect(lastOptions()).toMatchObject({
      customClass: 'mansion-dn mansion-dn--success',
      duration: 3200,
      showClose: true
    })
    expect(renderLastNotice()).toContain('javdb 磁力')
    expect(renderLastNotice()).toContain('剪贴板')
  })

  it('失败：error 配色，留 8 秒读原因', () => {
    notifyDownload({
      title: 'ABC-123',
      source: { label: 'javdb 磁力' },
      result: result({ ok: false, outcome: 'failed', message: '迅雷协议建任务失败' })
    })

    expect(lastOptions()).toMatchObject({ customClass: 'mansion-dn mansion-dn--error', duration: 8000 })
    expect(renderLastNotice()).toContain('失败')
    expect(renderLastNotice()).toContain('迅雷协议建任务失败')
  })

  it('回退：warning 配色，6 秒', () => {
    notifyDownload({
      title: 'ABC-123',
      source: { label: 'onejav 种子' },
      result: result({ channel: 'thunder', fellBack: true, fallbackReason: '超时', message: '已添加任务' })
    })

    expect(lastOptions()).toMatchObject({ customClass: 'mansion-dn mansion-dn--warning', duration: 6000 })
    expect(renderLastNotice()).toContain('已回退')
    expect(renderLastNotice()).toContain('miao 回退：超时')
  })
})

describe('notifyIntent：没有通道参与的前置结局', () => {
  it('已归档：省掉路径行，只留番号、状态词与结局', () => {
    notifyIntent({ title: 'ABC-123', type: 'info', statusText: '已归档', detail: '之前已交付过，本次跳过' })

    expect(lastOptions()).toMatchObject({ customClass: 'mansion-dn mansion-dn--info', duration: 3200 })

    const text = renderLastNotice()
    expect(text).toContain('ABC-123')
    expect(text).toContain('已归档')
    expect(text).toContain('之前已交付过，本次跳过')
    expect(text).not.toContain('→')
  })

  it('解析失败：error 配色，原因进诊断行', () => {
    notifyIntent({
      title: 'ABC-123',
      type: 'error',
      statusText: '失败',
      detail: '解析下载地址失败',
      notes: ['没有找到详情页']
    })

    expect(lastOptions()).toMatchObject({ customClass: 'mansion-dn mansion-dn--error', duration: 8000 })

    const text = renderLastNotice()
    expect(text).toContain('失败')
    expect(text).toContain('解析下载地址失败')
    expect(text).toContain('没有找到详情页')
  })
})
