import {
  ThunderApiError,
  ThunderTransportError,
  type MiaoClient,
  type AddTaskFileRef,
  type AddTaskOptions,
  type AddTaskResult,
  type AddTaskSeedSource,
  type Health
} from '@hikyuu/miao'
import { useConfigStore } from '@/store/config-store.ts'
import { useSiteStore } from '@/store/site-store.ts'
import { SiteId } from '@/site/site-id'
import { createMiaoClient } from '@/download/miao-client.ts'
import { miaoBrowserDownload } from '@/download/miao-proxy.ts'
import { requestFileSelection } from '@/download/file-picker.ts'
import { fetchTorrentBase64, TorrentFetchError } from '@/download/torrent.ts'
import { CloudflareBlockedError } from '@/common/cloudflare.ts'

/** miao 任务类型：exhentai 画廊任务，其余站点视频任务 */
export type MiaoTaskKind = 'gallery' | 'video'

/** download(url) 入参的分类 */
export type DownloadUrlKind = 'magnet' | 'torrent' | 'other'

/** miao 下载尝试的结局 */
export interface MiaoAttempt {
  /**
   * created=已建任务；fallback=需回退迅雷（message 为原因）；cancelled=用户取消，不回退；
   * blocked=种子被 Cloudflare 拦下且 miao 代下载也没成 —— 换一条地址才可能成功，不回退迅雷。
   */
  status: 'created' | 'fallback' | 'cancelled' | 'blocked'
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



/**
 * miao 通道主入口：磁链 / 远程种子建任务（按站点选画廊或视频任务），
 * needsSelection 弹窗勾选后带 files 重试；任何失败返回 fallback 交由迅雷兜底。
 */
export async function miaoDownload(url: string): Promise<MiaoAttempt> {
  const { savePath, baseUrl } = useConfigStore().common.miao
  const target = url.trim()
  const urlKind = classifyDownloadUrl(target)
  const decision = decideMiaoAction(urlKind)
  const siteId = useSiteStore().getSite.siteId
  const taskKind = pickTaskKind(siteId)
  const context = { url: target, urlKind, taskKind, baseUrl, savePath }
  console.log('[miao] 提交建任务', context)
  if (!decision.proceed) {
    console.log('[miao] 跳过建任务', decision.reason)
    return { status: 'fallback', message: decision.reason }
  }

  try {
    const source = await resolveSeedSource(target, urlKind, siteId)
    console.log('[miao] 种子来源就绪', summarizeSource(source))
    const attempt = await addTask(createMiaoClient(baseUrl), taskKind, source, savePath.trim())
    console.log('[miao] 结局', attempt)
    return attempt
  } catch (error) {
    logMiaoError('建任务', error, context)
    // 种子被 Cloudflare 拦下：同一条地址回退迅雷也一样过不去，交给上层换地址
    if (error instanceof CloudflareBlockedError) {
      return { status: 'blocked', message: error.message }
    }
    return { status: 'fallback', message: describeMiaoError(error) }
  }
}

/**
 * 需要 miao 代下载（`web.download`）的站点。
 *
 * 只有「对非导航请求也下 Turnstile」的站点才需要它：onejav 的 `file.*` 子域属于这类，
 * 浏览器栈（GM）拿不到字节。其它站点一律走 GM 直取 —— exhentai 靠浏览器登录态，
 * 本来就不需要过盾；用黑名单（排除 exhentai）会让将来新增的站点默认白等一次过盾。
 */
const PROXY_DOWNLOAD_SITES: ReadonlySet<SiteId> = new Set<SiteId>([SiteId.ONEJAV])

/**
 * 种子来源：磁链原样透传；远程种子先拿到字节，再以 base64 上传（免种子目录白名单）。
 *
 * 白名单内的站点（onejav）**只走** `web.download({ mode: 'auto' })`：由服务端先试纯 HTTP、
 * 撞挑战再降级浏览器下载栈，代下载失败也不回落 GM（那条请求必被 Turnstile 拦下），直接判 blocked 换地址。
 * 其余站点走 GM 直取。miao 侧还有一层站点白名单（fail-closed），没配的会被快速拒掉。
 */
async function resolveSeedSource(
  url: string,
  urlKind: DownloadUrlKind,
  siteId: SiteId
): Promise<AddTaskSeedSource> {
  if (urlKind === 'torrent') {
    const proxy = PROXY_DOWNLOAD_SITES.has(siteId) ? miaoBrowserDownload : undefined
    return { torrentBase64: await fetchTorrentBase64(url, proxy ? { proxy, proxyOnly: true } : {}) }
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
    const client = createMiaoClient(baseUrl)
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

    // 建任务通不代表过盾可用：过盾（web 能力）是独立开关，缺件时下载被拦就没有兜底
    const clearance = describeClearanceReadiness(health)
    const dirText = defaultSavePath ? `，默认下载目录：${defaultSavePath}` : ''
    if (!clearance.ready) {
      return {
        ok: true,
        type: 'warning',
        message: `连接正常（apiVersion ${health.apiVersion}）${dirText}，但${clearance.message}，被拦的站点会直接失败`
      }
    }
    return {
      ok: true,
      type: 'success',
      message: `连接正常（apiVersion ${health.apiVersion}）${dirText}，${clearance.message}`
    }
  } catch (error) {
    return { ok: false, type: 'error', message: describeMiaoError(error) }
  }
}

/**
 * 过盾就绪度：web 能力（`apiVersion ≥ 3`）→ 站点白名单 → 过盾器可达 → 允许导出凭证。
 *
 * health 里的 web 字段都是可选的：老版本 miao 不返回，用 `undefined` 判「版本过低」，
 * 不能按 `false` 报错。
 */
function describeClearanceReadiness(health: Health): { ready: boolean; message: string } {
  if (health.webSupported !== true) {
    return { ready: false, message: 'miao 未启用 web 能力（需 apiVersion ≥ 3）' }
  }
  if (!health.webHostWhitelistReady) {
    return { ready: false, message: 'miao 未配置站点白名单，过盾会被拒绝' }
  }
  if (health.solverReachable === false) {
    return { ready: false, message: '过盾器未启动（去 miao 的「过盾」页启动）' }
  }
  if (health.cookieExportAllowed === false) {
    return { ready: false, message: 'miao 关闭了过盾凭证导出，无法自行重取' }
  }
  return { ready: true, message: '过盾就绪' }
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
  const config = await createMiaoClient(baseUrl).getConfig()
  return {
    savePaths: Array.isArray(config.savePaths) ? config.savePaths.filter((path) => !!path) : [],
    defaultSavePath: config.defaultSavePath || null
  }
}

async function addTask(
  client: MiaoClient,
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
