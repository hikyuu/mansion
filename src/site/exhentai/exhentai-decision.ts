import {
  HentaiArchiveStatus,
  isNewerThanWaterline,
  pickLatestOperatedArchive,
  resolveArchiveWaterline,
  type HentaiArchiveDto
} from '@/dao/hentai-archive'

/**
 * 画廊条目在列表页上的五种结局。
 * bind / enqueue 由 kind 隐含：只有 stale-seed 会入队复查，ready / stale-seed 会绑定下载。
 */
export type GalleryEntryKind =
  /** 用户标记跳过下载：不绑定、不入队 */
  | 'skip-download'
  /** 只拿到过时种子：置灰 + 绑定 + 入队，每次进页面复查最新种子 */
  | 'stale-seed'
  /** 已交付且无新版本：不绑定，未整条隐藏时由绑定层隐藏按钮 */
  | 'up-to-date'
  /** 可下载：绑定，不入队 */
  | 'ready'
  /** 没有种子：不绑定、不入队 */
  | 'no-torrent'

export interface GalleryEntryDecision {
  kind: GalleryEntryKind
  /** 是否整条隐藏 */
  hidden: boolean
  /** 判定原因，日志与提示共用 */
  reason: string
}

export interface GalleryEntryInput {
  /** 该标题 hash 下的归档记录；undefined = 未查过，[] = 查过但没有 */
  archives?: HentaiArchiveDto[]
  /** 列表页画廊日期 */
  galleryDate: Date | null
  /** 是否存在可下载按钮（有 a[href]） */
  hasTorrent: boolean
  skipRead: boolean
  onlyShowDownloadable: boolean
}

/**
 * 画廊条目的判重决策（纯函数）。
 *
 * 判定顺序即优先级：
 * 1. 400（用户跳过）优先于一切 —— 同标题 hash 即视为已处理，不看日期、不看种子
 * 2. 没有种子 —— 再新的画廊也无从下载
 * 3. 304（过时种子）—— 置灰 + 入队复查
 * 4. 200（已交付）—— 日期比水位线新才算有新版本
 * 5. 其余（无归档）—— 可直接下载
 *
 * 状态与水位线口径分别来自 dao 的 pickLatestOperatedArchive / resolveArchiveWaterline，
 * 不允许在这里重写比较逻辑。
 */
export function decideGalleryEntry(input: GalleryEntryInput): GalleryEntryDecision {
  const { archives, galleryDate, hasTorrent, skipRead, onlyShowDownloadable } = input
  // 当前状态由「最后一次写入的记录」决定（400 跳过 / 304 过时种子 / 200 已交付）
  const latest = pickLatestOperatedArchive(archives)

  if (latest?.status === HentaiArchiveStatus.SkipDownload) {
    return {
      kind: 'skip-download',
      // 只显示可下载时整条隐藏；否则只在跳过已读时隐藏
      hidden: onlyShowDownloadable || skipRead,
      reason: '用户标记跳过下载'
    }
  }

  if (!hasTorrent) {
    return { kind: 'no-torrent', hidden: onlyShowDownloadable, reason: '没有种子' }
  }

  if (latest?.status === HentaiArchiveStatus.NoNewerSeed) {
    // 仅显示可下载时整条隐藏，但调用方仍要绑定 + 入队，保证后台复查最新种子
    return { kind: 'stale-seed', hidden: onlyShowDownloadable, reason: '只拿到过时种子' }
  }

  if (latest?.status === HentaiArchiveStatus.DownloadSuccess) {
    // 只有画廊日期比判重水位线更新才算有新版本（与下载 handler 同一口径，比较收在 dao）
    if (!isNewerThanWaterline(galleryDate, resolveArchiveWaterline(archives))) {
      return { kind: 'up-to-date', hidden: onlyShowDownloadable, reason: '已下载且无新版本' }
    }
    return { kind: 'ready', hidden: false, reason: '发现新版本' }
  }

  return { kind: 'ready', hidden: false, reason: '可下载' }
}
