// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThunderApiError, ThunderClient, ThunderTransportError, type AddTaskResult } from '@hikyuu/thunder-client'
import { SiteId } from '@/site/site-id'
import { download } from '@/download/index.ts'
import { gmFetch } from '@/download/gm-fetch.ts'
import { requestFileSelection } from '@/download/file-picker.ts'
import { fetchTorrentBase64, TorrentFetchError } from '@/download/torrent.ts'
import { thunderDownload } from '@/download/thunder.ts'
import { copyUrl } from '@/download/clipboard.ts'
import { miaoHealth } from '@/download/miao.ts'
import { useConfigStore } from '@/store/config-store.ts'
import { useSiteStore } from '@/store/site-store.ts'

vi.mock('vite-plugin-monkey/dist/client', () => ({
  GM_xmlhttpRequest: vi.fn<(details: unknown) => { abort: () => void }>(),
  GM_getValue: vi.fn<(key: string) => unknown>(),
  GM_setValue: vi.fn<(key: string, value: unknown) => void>(),
  monkeyWindow: {}
}))
vi.mock('element-plus', () => ({ ElNotification: vi.fn<(options: unknown) => void>() }))
vi.mock('@/download/gm-fetch.ts', () => ({
  gmFetch: vi.fn<(input: unknown, init?: unknown) => Promise<Response>>()
}))
vi.mock('@/download/file-picker.ts', () => ({
  requestFileSelection: vi.fn<(payload: unknown) => Promise<number[] | null>>()
}))
vi.mock('@/download/torrent.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, fetchTorrentBase64: vi.fn<(url: string) => Promise<string>>() }
})
vi.mock('@/download/thunder.ts', () => ({
  thunderDownload: vi.fn<(url: string) => boolean>()
}))
vi.mock('@/download/clipboard.ts', () => ({
  copyUrl: vi.fn<(text: string) => Promise<{ ok: boolean; message: string }>>()
}))
vi.mock('@/store/config-store.ts', () => ({ useConfigStore: vi.fn<() => unknown>() }))
vi.mock('@/store/site-store.ts', () => ({ useSiteStore: vi.fn<() => unknown>() }))
vi.mock('@hikyuu/thunder-client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, ThunderClient: vi.fn<(...args: unknown[]) => unknown>() }
})

const MAGNET = 'magnet:?xt=urn:btih:624ed719aaf2205a5c7b4c72a6a0c97e7f66b0e2'
const TORRENT_URL = 'https://exhentai.org/torrent/1/abc.torrent'
const TORRENT_BASE64 = 'QkVUQ09ERUQ='
const THUNDER_MOCK = vi.mocked(thunderDownload)
const COPY_MOCK = vi.mocked(copyUrl)
const CLIENT_MOCK = vi.mocked(ThunderClient)
const PICKER_MOCK = vi.mocked(requestFileSelection)
const TORRENT_MOCK = vi.mocked(fetchTorrentBase64)

const client = {
  addVideoTask: vi.fn<(options: unknown) => Promise<unknown>>(),
  addGalleryTask: vi.fn<(options: unknown) => Promise<unknown>>(),
  health: vi.fn<() => Promise<unknown>>(),
  getConfig: vi.fn<() => Promise<unknown>>()
}

function createdResult(overrides: Partial<Record<string, unknown>> = {}): AddTaskResult {
  return {
    outcome: 'created',
    taskId: 4242,
    status: 'pending',
    statusCode: 7,
    label: '未开始',
    started: true,
    magnetTaskId: null,
    metadataPath: null,
    duplicate: false,
    selectedIndexes: [0],
    ...overrides
  } as AddTaskResult
}

function needsSelectionResult(): AddTaskResult {
  return {
    outcome: 'needsSelection',
    message: '有 2 个大于 100MB 的视频文件，请用 files 参数指定要下载的文件。',
    name: 'demo',
    totalSize: 4294967296,
    files: [
      { index: 0, path: 'a.mkv', size: 2147483648 },
      { index: 1, path: 'b.mp4', size: 2147483648 }
    ],
    magnetTaskId: null,
    metadataPath: null
  } as AddTaskResult
}

function messageResult(message: string): AddTaskResult {
  return { outcome: 'message', message, magnetTaskId: null, metadataPath: null } as AddTaskResult
}

function healthResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ok: true,
    platform: 'windows',
    thunderSupported: true,
    thunderConnected: true,
    savePathWhitelistReady: true,
    seedPathWhitelistReady: true,
    authRequired: false,
    apiVersion: 1,
    ...overrides
  }
}

function mockConfig(overrides: { method?: string; savePath?: string; baseUrl?: string; siteId?: SiteId } = {}) {
  vi.mocked(useConfigStore).mockReturnValue({
    common: {
      miao: {
        savePath: overrides.savePath ?? 'L:\\Downloads',
        baseUrl: overrides.baseUrl ?? 'http://127.0.0.1:6427'
      }
    },
    getSiteConfig: { downloadMethod: overrides.method ?? 'miao' }
  } as unknown as ReturnType<typeof useConfigStore>)
  vi.mocked(useSiteStore).mockReturnValue({
    getSite: { siteId: overrides.siteId ?? SiteId.JAVDB }
  } as unknown as ReturnType<typeof useSiteStore>)
}

beforeEach(() => {
  vi.clearAllMocks()
  client.addVideoTask.mockReset()
  client.addGalleryTask.mockReset()
  client.health.mockReset()
  client.getConfig.mockReset()
  // 构造调用（new ThunderClient）必须用普通函数：箭头函数不是构造器
  CLIENT_MOCK.mockImplementation(function () {
    return client as unknown as InstanceType<typeof ThunderClient>
  })
  THUNDER_MOCK.mockImplementation(() => true)
  COPY_MOCK.mockImplementation(async () => ({ ok: true, message: '已复制下载链接' }))
  PICKER_MOCK.mockResolvedValue(null)
  TORRENT_MOCK.mockReset()
  TORRENT_MOCK.mockResolvedValue(TORRENT_BASE64)
  client.getConfig.mockResolvedValue({ defaultSavePath: null, savePaths: [], seedPaths: [], apiVersion: 1 })
  mockConfig()
})

describe('miao 成功路径', () => {
  it('视频站点磁链走 addVideoTask，成功不再回退', async () => {
    client.addVideoTask.mockResolvedValue(createdResult())
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'miao', fellBack: false })
    expect(client.addVideoTask).toHaveBeenCalledWith({ magnet: MAGNET, savePath: 'L:\\Downloads' })
    expect(client.addGalleryTask).not.toHaveBeenCalled()
    expect(THUNDER_MOCK).not.toHaveBeenCalled()
  })

  it('exhentai 磁链走 addGalleryTask（画廊任务）', async () => {
    mockConfig({ siteId: SiteId.EXHENTAI })
    client.addGalleryTask.mockResolvedValue(createdResult())
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'miao' })
    expect(client.addGalleryTask).toHaveBeenCalledWith({ magnet: MAGNET, savePath: 'L:\\Downloads' })
    expect(client.addVideoTask).not.toHaveBeenCalled()
  })

  it('savePath 留空：交给 miao，走服务端默认下载目录', async () => {
    mockConfig({ savePath: '' })
    client.addVideoTask.mockResolvedValue(createdResult())
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'miao' })
    expect(client.addVideoTask).toHaveBeenCalledWith({ magnet: MAGNET })
    expect(THUNDER_MOCK).not.toHaveBeenCalled()
  })

  it('命中幂等（duplicate）：提示任务已存在', async () => {
    client.addVideoTask.mockResolvedValue(createdResult({ taskId: 99, duplicate: true }))
    const result = await download(MAGNET)
    expect(result.ok).toBe(true)
    expect(result.message).toContain('任务已存在')
  })

  it('ThunderClient 注入 gmFetch 与 baseUrl（超时用 SDK 分接口默认值）', async () => {
    client.addVideoTask.mockResolvedValue(createdResult())
    await download(MAGNET)
    expect(CLIENT_MOCK).toHaveBeenCalledWith({ baseUrl: 'http://127.0.0.1:6427', fetch: gmFetch })
  })

  it('baseUrl 为空时交给 SDK 默认地址（不拼相对 URL）', async () => {
    mockConfig({ baseUrl: '  ' })
    client.addVideoTask.mockResolvedValue(createdResult())
    await download(MAGNET)
    expect(CLIENT_MOCK).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: undefined }))
  })
})

describe('种子链接直投（torrentBase64）', () => {
  it('exhentai 种子：下载编码后走 addGalleryTask', async () => {
    mockConfig({ siteId: SiteId.EXHENTAI })
    client.addGalleryTask.mockResolvedValue(createdResult())
    const result = await download(TORRENT_URL)
    expect(result).toMatchObject({ ok: true, channel: 'miao', fellBack: false })
    expect(TORRENT_MOCK).toHaveBeenCalledWith(TORRENT_URL)
    expect(client.addGalleryTask).toHaveBeenCalledWith({
      torrentBase64: TORRENT_BASE64,
      savePath: 'L:\\Downloads'
    })
    expect(client.addVideoTask).not.toHaveBeenCalled()
    expect(THUNDER_MOCK).not.toHaveBeenCalled()
  })

  it('onejav 种子：走 addVideoTask', async () => {
    client.addVideoTask.mockResolvedValue(createdResult())
    await download('https://onejav.com/torrent/a/download/1/a.torrent')
    expect(client.addVideoTask).toHaveBeenCalledWith({
      torrentBase64: TORRENT_BASE64,
      savePath: 'L:\\Downloads'
    })
  })

  it('种子下载失败（失效/需登录）：回退迅雷并说明原因', async () => {
    TORRENT_MOCK.mockRejectedValue(new TorrentFetchError('响应不是有效的种子文件（链接可能失效或需要登录）'))
    const result = await download(TORRENT_URL)
    expect(result).toMatchObject({ ok: true, channel: 'thunder', fellBack: true })
    expect(result.fallbackReason).toContain('有效的种子文件')
    expect(client.addGalleryTask).not.toHaveBeenCalled()
  })
})

describe('needsSelection 文件勾选', () => {
  it('勾选后带 files 重试', async () => {
    client.addVideoTask.mockResolvedValueOnce(needsSelectionResult()).mockResolvedValueOnce(createdResult())
    PICKER_MOCK.mockResolvedValue([0, 2])
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'miao' })
    expect(client.addVideoTask).toHaveBeenNthCalledWith(1, { magnet: MAGNET, savePath: 'L:\\Downloads' })
    expect(client.addVideoTask).toHaveBeenNthCalledWith(2, { magnet: MAGNET, savePath: 'L:\\Downloads', files: [0, 2] })
    expect(THUNDER_MOCK).not.toHaveBeenCalled()
  })

  it('取消勾选：不建任务也不回退迅雷', async () => {
    client.addVideoTask.mockResolvedValue(needsSelectionResult())
    PICKER_MOCK.mockResolvedValue(null)
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: false, channel: 'miao', fellBack: false })
    expect(client.addVideoTask).toHaveBeenCalledTimes(1)
    expect(THUNDER_MOCK).not.toHaveBeenCalled()
  })
})

describe('miao 失败自动回退迅雷', () => {
  async function expectFallback(messagePart: string, error: unknown) {
    client.addVideoTask.mockRejectedValue(error)
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'thunder', fellBack: true, outcome: 'created' })
    expect(THUNDER_MOCK).toHaveBeenCalledWith(MAGNET)
    // 通道不再自己弹通知，原因结构化交给意图层拼「来源 → 通道：结局」
    expect(result.fallbackReason).toContain(messagePart)
  }

  it('连不上 miao（ThunderTransportError）', async () => {
    await expectFallback('无法连接 miao 服务', new ThunderTransportError('无法连接服务：POST /x'))
  })

  it('401：提示清空 token', async () => {
    await expectFallback('token', new ThunderApiError(401, 'UNAUTHORIZED', '未授权'))
  })

  it('403 SAVE_PATH_WHITELIST_EMPTY：提示白名单未配置', async () => {
    await expectFallback('下载目录白名单', new ThunderApiError(403, 'SAVE_PATH_WHITELIST_EMPTY', '白名单未配置'))
  })

  it('403 SAVE_PATH_NOT_ALLOWED：提示路径不在白名单', async () => {
    await expectFallback('未命中', new ThunderApiError(403, 'SAVE_PATH_NOT_ALLOWED', '路径不允许'))
  })

  it('403 ORIGIN_NOT_ALLOWED：提示跨源白名单', async () => {
    await expectFallback('跨源白名单', new ThunderApiError(403, 'ORIGIN_NOT_ALLOWED', '来源不允许'))
  })

  it('502 THUNDER_UNAVAILABLE：提示迅雷未启动', async () => {
    await expectFallback('迅雷未启动', new ThunderApiError(502, 'THUNDER_UNAVAILABLE', '迅雷不可用'))
  })

  it('METADATA_TIMEOUT：提示元数据超时', async () => {
    await expectFallback('元数据超时', new ThunderApiError(504, 'METADATA_TIMEOUT', '等待元数据超时'))
  })

  it('PERSIST_TIMEOUT：提示入库超时', async () => {
    await expectFallback('入库超时', new ThunderApiError(504, 'PERSIST_TIMEOUT', '等待入库超时'))
  })

  it('504 TIMEOUT：提示超时', async () => {
    await expectFallback('超时', new ThunderApiError(504, 'TIMEOUT', '等待超时'))
  })

  it('message 结局（无可下载目标）也回退迅雷整链', async () => {
    client.addVideoTask.mockResolvedValue(messageResult('没有大于 100MB 的视频文件。'))
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'thunder', fellBack: true })
    expect(result.fallbackReason).toContain('没有大于 100MB 的视频文件。')
  })

  it('未知异常按原始文案回退', async () => {
    await expectFallback('boom', new Error('boom'))
  })

  it('迅雷回退也失败：ok=false 且说明回退失败', async () => {
    client.addVideoTask.mockRejectedValue(new ThunderTransportError('x'))
    THUNDER_MOCK.mockReturnValueOnce(false)
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: false, channel: 'thunder', fellBack: true, outcome: 'failed' })
    expect(result.message).toBe('迅雷协议建任务失败')
    expect(result.fallbackReason).toContain('无法连接 miao 服务')
  })
})

describe('前置拦截（不建 miao 客户端）', () => {
  it('直链 URL：直接回退迅雷', async () => {
    const result = await download('https://file.onejav.com/video.mp4')
    expect(result).toMatchObject({ ok: true, channel: 'thunder', fellBack: true })
    expect(CLIENT_MOCK).not.toHaveBeenCalled()
    expect(result.fallbackReason).toContain('磁链与种子链接')
  })
})

describe('downloadMethod 分发', () => {
  it('迅雷：直接走迅雷协议，不经过 miao', async () => {
    mockConfig({ method: 'thunder' })
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'thunder', fellBack: false })
    expect(THUNDER_MOCK).toHaveBeenCalledWith(MAGNET)
    expect(CLIENT_MOCK).not.toHaveBeenCalled()
  })

  it('复制：走剪贴板通道', async () => {
    mockConfig({ method: 'copy' })
    const result = await download(MAGNET)
    expect(result).toMatchObject({ ok: true, channel: 'copy', fellBack: false, message: '已复制下载链接' })
    expect(COPY_MOCK).toHaveBeenCalledWith(MAGNET)
    expect(THUNDER_MOCK).not.toHaveBeenCalled()
    expect(CLIENT_MOCK).not.toHaveBeenCalled()
  })
})

describe('miaoHealth 连接测试', () => {
  it('正常：ok 并展示默认下载目录', async () => {
    client.health.mockResolvedValue(healthResult())
    client.getConfig.mockResolvedValue({
      defaultSavePath: 'L:\\Downloads',
      savePaths: ['L:\\Downloads'],
      seedPaths: [],
      apiVersion: 1
    })
    const result = await miaoHealth()
    expect(result.ok).toBe(true)
    expect(result.message).toContain('apiVersion 1')
    expect(result.message).toContain('L:\\Downloads')
  })

  it('未配置下载目录白名单：warning', async () => {
    client.health.mockResolvedValue(healthResult({ savePathWhitelistReady: false }))
    const result = await miaoHealth()
    expect(result.ok).toBe(false)
    expect(result.type).toBe('warning')
    expect(result.message).toContain('白名单')
  })

  it('服务端启用 token：warning 提示会回退迅雷', async () => {
    client.health.mockResolvedValue(healthResult({ authRequired: true }))
    const result = await miaoHealth()
    expect(result.type).toBe('warning')
    expect(result.message).toContain('token')
  })

  it('迅雷未连接：warning', async () => {
    client.health.mockResolvedValue(healthResult({ thunderConnected: false }))
    const result = await miaoHealth()
    expect(result.ok).toBe(false)
    expect(result.type).toBe('warning')
    expect(result.message).toContain('迅雷未启动')
  })

  it('非 Windows：error', async () => {
    client.health.mockResolvedValue(healthResult({ thunderSupported: false }))
    const result = await miaoHealth()
    expect(result.type).toBe('error')
    expect(result.message).toContain('Windows')
  })

  it('连不上服务：error 并提示未开 REST', async () => {
    client.health.mockRejectedValue(new ThunderTransportError('x'))
    const result = await miaoHealth()
    expect(result.ok).toBe(false)
    expect(result.type).toBe('error')
    expect(result.message).toContain('未开启 REST 接口')
  })

  it('getConfig 失败不影响体检结论', async () => {
    client.health.mockResolvedValue(healthResult())
    client.getConfig.mockRejectedValue(new ThunderApiError(401, 'UNAUTHORIZED', 'x'))
    const result = await miaoHealth()
    expect(result.ok).toBe(true)
  })
})
