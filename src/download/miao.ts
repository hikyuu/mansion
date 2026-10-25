import {
  ThunderApiError,
  ThunderClient,
  ThunderTransportError,
  type AddTaskFileRef,
  type AddTaskOptions,
  type AddTaskResult,
  type AddTaskSeedSource
} from '@hikyuu/thunder-client'
import { useConfigStore } from '@/store/config-store.ts'
import { useSiteStore } from '@/store/site-store.ts'
import { SiteId } from '@/site/site-id'
import { gmFetch } from '@/download/gm-fetch.ts'
import { requestFileSelection } from '@/download/file-picker.ts'
import {
  fetchTorrentBase64,
  TorrentFetchError,
  type TorrentClearanceOptions
} from '@/download/torrent.ts'

/** miao 任务类型：exhentai 画廊任务，其余站点视频任务 */
export type MiaoTaskKind = 'gallery' | 'video'

/** download(url) 入参的分类 */
export type DownloadUrlKind = 'magnet' | 'torrent' | 'other'

/** miao 下载尝试的结局 */
export interface MiaoAttempt {
  /** created=已建任务；fallback=需回退迅雷（message 为原因）；cancelled=用户取消，不回退 */
  status: 'created' | 'fallback' | 'cancelled'
  message: string
}

export function classifyDownloadUrl(url: string): DownloadUrlKind {
  const trimmed = url.trim()
  if (!trimmed) return 'other'
  if (/^magnet:/i.test(trimmed)) return 'magnet'
  const path = trimmed.split(/[?#]/)[0] ?? ''
  if (/\.torrent$/i.test(path) || /\.zip$/i.test(path) || /\/torrent\//i.test(path)) return 'torrent'
  return 'other'
}

export function pickTaskKind(siteId: SiteId): MiaoTaskKind {
  return siteId === SiteId.EXHENTAI ? 'gallery' : 'video'
}

/**
 * 种子链路被 Cloudflare 拦住时，用哪个站点标识去换 cf_clearance。
 * 目前只有 onejav 的种子链接会撞挑战页；其余站点传 undefined，命中拦截时只报原因不做重试。
 */
export function clearanceFor(siteId: SiteId): TorrentClearanceOptions | undefined {
  if (siteId === SiteId.ONEJAV) return { site: 'onejav', cookieDomain: 'onejav.com' }
  return undefined
}

export interface MiaoDecision {
  proceed: boolean
  reason: string
}

/** 纯决策：磁链与种子链接都能交给 miao（种子走 torrentBase64 上传），其余回退迅雷 */
export function decideMiaoAction(urlKind: DownloadUrlKind): MiaoDecision {
  if (urlKind === 'other') {
    return { proceed: false, reason: 'miao 仅支持磁链与种子链接' }
  }
  return { proceed: true, reason: '' }
}

/** 错误 → 可展示的回退原因文案 */
export function describeMiaoError(error: unknown): string {
  if (error instanceof TorrentFetchError) return error.message
  if (error instanceof ThunderApiError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        return 'miao 已启用 token 访问控制，请在 miao 侧清空 token'
      case 'SAVE_PATH_WHITELIST_EMPTY':
        return 'miao 未配置下载目录白名单（fail-closed），请先在 miao 设置里配置'
      case 'SAVE_PATH_NOT_ALLOWED':
        return 'savePath 未命中 miao 下载目录白名单'
      case 'HOST_NOT_ALLOWED':
        return 'Host 校验被拒，请通过服务绑定的 host:port 访问 miao'
      case 'ORIGIN_NOT_ALLOWED':
        return '请求来源不在 miao 的跨源白名单内'
      case 'THUNDER_UNAVAILABLE':
        return 'miao 在线但迅雷未启动或 IPC 不可用'
      case 'METADATA_TIMEOUT':
        return '等待种子元数据超时（检查 Tracker/网络后重试）'
      case 'PERSIST_TIMEOUT':
        return '迅雷入库超时，可尝试重启迅雷'
      case 'TIMEOUT':
        return 'miao 等待超时，可尝试重启迅雷'
      case 'UNSUPPORTED':
        return 'miao 服务端不是 Windows，不支持迅雷任务'
      case 'BAD_REQUEST':
        return 'miao 拒绝了请求参数：' + error.message
      default:
        return error.message || 'miao 接口调用失败'
    }
  }
  if (error instanceof ThunderTransportError) {
    return '无法连接 miao 服务（未启动或未开启 REST 接口）'
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * 回退前的诊断日志。
 * 回退文案只保留可读信息，定位问题需要服务端返回的 code / body 与原始错误对象。
 */
function logMiaoError(stage: string, error: unknown, context: Record<string, unknown>): void {
  const detail =
    error instanceof ThunderApiError
      ? { code: error.code, status: error.statusCode, reason: error.reason, body: error.body }
      : { name: error instanceof Error ? error.name : typeof error }
  console.error(`[miao] ${stage}失败`, { ...context, ...detail, error })
}

/** 种子来源摘要：base64 只打长度，避免把整颗种子刷进控制台 */
function summarizeSource(source: AddTaskSeedSource): Record<string, unknown> {
  if (source.torrentBase64) return { torrentBase64Length: source.torrentBase64.length }
  if (source.seedFile) return { seedFile: source.seedFile }
  return { magnet: source.magnet }
}

function createClient(baseUrl: string): ThunderClient {
  const trimmed = baseUrl.trim()
  // 超时用 SDK 分接口默认值（建任务 90s / 查询 15s / health 5s），无需在此覆盖
  return new ThunderClient({
    // 空串回退 SDK 默认地址，避免拼出相对 URL 请求到当前页面
    baseUrl: trimmed || undefined,
    fetch: gmFetch
  })
}

/**
 * miao 通道主入口：磁链 / 远程种子建任务（按站点选画廊或视频任务），
 * needsSelection 弹窗勾选后带 files 重试；任何失败返回 fallback 交由迅雷兜底。
 */
export async function miaoDownload(url: string): Promise<MiaoAttempt> {
  const { savePath, baseUrl } = useConfigStore().common.miao
  const target = url.trim()
  const urlKind = classifyDownloadUrl(target)
  const decision = decideMiaoAction(urlKind)
  const taskKind = pickTaskKind(useSiteStore().getSite.siteId)
  const context = { url: target, urlKind, taskKind, baseUrl, savePath }
  console.log('[miao] 提交建任务', context)
  if (!decision.proceed) {
    console.log('[miao] 跳过建任务', decision.reason)
    return { status: 'fallback', message: decision.reason }
  }

  try {
    const source = await resolveSeedSource(target, urlKind, clearanceFor(useSiteStore().getSite.siteId))
    console.log('[miao] 种子来源就绪', summarizeSource(source))
    const attempt = await addTask(createClient(baseUrl), taskKind, source, savePath.trim())
    console.log('[miao] 结局', attempt)
    return attempt
  } catch (error) {
    logMiaoError('建任务', error, context)
    return { status: 'fallback', message: describeMiaoError(error) }
  }
}

/** 种子来源：磁链原样透传；远程种子先带 Cookie 下载，再以 base64 上传（免种子目录白名单） */
async function resolveSeedSource(
  url: string,
  urlKind: DownloadUrlKind,
  clearance?: TorrentClearanceOptions
): Promise<AddTaskSeedSource> {
  if (urlKind === 'torrent') {
    // 只有需要兜底的站点才多带一个参数，其余站点的调用保持原样
    return { torrentBase64: clearance ? await fetchTorrentBase64(url, { clearance }) : await fetchTorrentBase64(url) }
  }
  return { magnet: url }
}

/** 供设置面板「连接测试」使用 */
export interface MiaoHealthResult {
  ok: boolean
  type: 'success' | 'warning' | 'error'
  message: string
}

export async function miaoHealth(): Promise<MiaoHealthResult> {
  const { baseUrl } = useConfigStore().common.miao
  try {
    const client = createClient(baseUrl)
    const health = await client.health()
    if (!health.thunderSupported) {
      return { ok: false, type: 'error', message: 'miao 服务端不是 Windows，不支持迅雷任务' }
    }
    if (health.authRequired) {
      return { ok: false, type: 'warning', message: 'miao 启用了 token 鉴权，当前集成未配置 token，下载会回退迅雷' }
    }
    if (!health.savePathWhitelistReady) {
      return { ok: false, type: 'warning', message: 'miao 未配置下载目录白名单（fail-closed），建任务会被拒绝' }
    }
    if (!health.thunderConnected) {
      return { ok: false, type: 'warning', message: 'miao 在线，但迅雷未启动或 IPC 不可用' }
    }

    // 顺带读一次默认下载目录（savePath 留空时服务端用它），失败不影响体检结论
    let defaultSavePath: string | null = null
    try {
      defaultSavePath = (await client.getConfig()).defaultSavePath
    } catch {
      // ignore：config 需要鉴权，读不到按未配置处理
    }
    const dirText = defaultSavePath ? `，默认下载目录：${defaultSavePath}` : ''
    return { ok: true, type: 'success', message: `连接正常（apiVersion ${health.apiVersion}）${dirText}` }
  } catch (error) {
    return { ok: false, type: 'error', message: describeMiaoError(error) }
  }
}

/** 服务端下载目录白名单与默认目录（供设置面板「下载目录」下拉使用） */
export interface MiaoSavePathList {
  savePaths: string[]
  defaultSavePath: string | null
}

/**
 * 读取 miao 的下载目录白名单。
 * `GET /api/v1/config` 需要鉴权：服务端启用 token 时会抛 UNAUTHORIZED，
 * 调用方应降级为手动输入，而不是阻断用户。
 */
export async function fetchMiaoSavePaths(): Promise<MiaoSavePathList> {
  const { baseUrl } = useConfigStore().common.miao
  const config = await createClient(baseUrl).getConfig()
  return {
    savePaths: Array.isArray(config.savePaths) ? config.savePaths.filter((path) => !!path) : [],
    defaultSavePath: config.defaultSavePath || null
  }
}

async function addTask(
  client: ThunderClient,
  taskKind: MiaoTaskKind,
  source: AddTaskSeedSource,
  savePath: string
): Promise<MiaoAttempt> {
  const add = (files?: AddTaskFileRef[]): Promise<AddTaskResult> => {
    const options: AddTaskOptions = {
      ...source,
      // savePath 可选：留空走 miao 侧「默认下载目录」
      ...(savePath ? { savePath } : {}),
      ...(files && files.length > 0 ? { files } : {})
    }
    return taskKind === 'gallery' ? client.addGalleryTask(options) : client.addVideoTask(options)
  }

  let result = await add()
  if (result.outcome === 'needsSelection') {
    const selected = await requestFileSelection({ name: result.name, files: result.files })
    if (selected === null || selected.length === 0) {
      return { status: 'cancelled', message: '已取消文件选择' }
    }
    result = await add(selected)
  }

  // 通知由下载意图层统一出（标题=番号），此处只回传通道侧文案
  if (result.outcome === 'created') {
    const count = result.selectedIndexes.length
    const duplicated = result.duplicate ? '（任务已存在，未重复创建）' : ''
    return {
      status: 'created',
      message: `已添加任务 #${result.taskId}${count > 0 ? `（${count} 个文件）` : ''}${duplicated}`
    }
  }

  // message 结局（无可下载目标）或重试后仍 needsSelection：回退迅雷整链下载，保证下载意图不落空
  return { status: 'fallback', message: result.message || 'miao 没有可下载的目标' }
}
