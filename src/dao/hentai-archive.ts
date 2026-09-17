import { useUserStore } from '@/store/user-store'
import { sha256Hex } from '@/common/hash'
import dayjs from 'dayjs'

export enum HentaiArchiveStatus {
  DownloadSuccess = 200,
  NoNewerSeed = 304, // 没有更新的种子即过时
  SkipDownload = 400 // 用户主动标记跳过下载
}

export declare interface HentaiArchiveDto {
  id: number
  gid: number
  date: Date
  user_id: string
  created_time: Date
  status: HentaiArchiveStatus
  title: string
  title_hash: string
  [key: string]: unknown
}

function normalizeArchive(item: Record<string, unknown> | null): HentaiArchiveDto | null {
  if (!item) return item

  // 处理 date 字段 - 使用 dayjs
  if (item.date !== undefined && item.date !== null) {
    const dateObj = dayjs(item.date as string | number | Date)
    item.date = dateObj.isValid() ? dateObj.toDate() : dayjs().toDate()
  } else {
    item.date = dayjs().toDate()
  }

  // 处理 created_time 字段 - 使用 dayjs
  if (item.created_time !== undefined && item.created_time !== null) {
    const dateObj = dayjs(item.created_time as string | number | Date)
    item.created_time = dateObj.isValid() ? dateObj.toDate() : dayjs().toDate()
  } else {
    item.created_time = dayjs().toDate()
  }

  // 处理 status 字段
  const statusNum = typeof item.status === 'number' ? item.status : Number(item.status)
  if (statusNum === HentaiArchiveStatus.NoNewerSeed) {
    item.status = HentaiArchiveStatus.NoNewerSeed
  } else if (statusNum === HentaiArchiveStatus.SkipDownload) {
    item.status = HentaiArchiveStatus.SkipDownload
  } else {
    item.status = HentaiArchiveStatus.DownloadSuccess
  }

  // title 与 title_hash 必须成对且都不为空（数据库已有 NOT NULL + 非空 CHECK 兜底）
  const title = item.title === undefined || item.title === null ? '' : String(item.title)
  const titleHash = item.title_hash === undefined || item.title_hash === null ? '' : String(item.title_hash)
  if (!title || !titleHash) {
    return null
  }
  item.title = title
  item.title_hash = titleHash

  return item as HentaiArchiveDto
}

export async function upsertHentaiArchive(
  gid: number,
  date: Date,
  status: HentaiArchiveStatus,
  title: string
): Promise<HentaiArchiveDto | null> {
  const supabase = await useUserStore().getAuthSupabase()

  // 代码层约束：title 与 title_hash 必须都不为空（与数据库 NOT NULL + 非空 CHECK 对应）
  if (!title) {
    console.warn('hentai_archive: title 为空，拒绝写入', { gid, status })
    return null
  }
  const hash = await sha256Hex(title)
  if (!hash) {
    console.warn('hentai_archive: title_hash 计算失败，拒绝写入', { gid, title })
    return null
  }

  const record: Record<string, string | number> = {
    gid,
    date: dayjs(date).toISOString(),
    status: status,
    title,
    title_hash: hash,
    // 显式写入而不是依赖列默认 now()：默认值只在 insert 时生效，
    // 不写的话 upsert 后 created_time 会一直停留在首次插入时间，
    // 使"最近一次操作"的判定永远停在最早写下的那一行
    created_time: dayjs().toISOString()
  }
  const { data, error } = await supabase
    .from('hentai_archive')
    .upsert(record, { onConflict: 'title_hash,status,user_id' })
    .select()
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  if (Array.isArray(data) && data.length > 0) {
    return normalizeArchive(data[0])
  }
  return null
}

/** 归档判重结果：统一口径，列表页与下载 handler 必须共用 */
export interface ArchiveWaterline {
  /** date 最大的已处理记录（200/304），无则 null；400（用户跳过）不参与判重 */
  archive: HentaiArchiveDto | null
  /** 是否存在 200（已提交过最新种子）记录 */
  hasDownloaded: boolean
}

/**
 * 归档判重的唯一口径：水位线取 date 最大的 200/304 记录，并给出是否下载过最新种子。
 *
 * 为什么用 max(date) 而不是 max(created_time)：
 * - 304 记录的 date 写的是种子日期，200 记录的 date 写的是画廊日期，两者天然可比；
 * - created_time 只反映写入先后，304 行一旦晚于 200 行写入就会"永久胜出"，
 *   使列表页每次都判为需要自动复查，从而反复重新下载，永不自愈。
 */
export function resolveArchiveWaterline(archives?: HentaiArchiveDto[]): ArchiveWaterline {
  const processed = (archives ?? []).filter(
    (a) => a.status === HentaiArchiveStatus.DownloadSuccess || a.status === HentaiArchiveStatus.NoNewerSeed
  )
  if (processed.length === 0) return { archive: null, hasDownloaded: false }

  const archive = processed.reduce((latest, current) =>
    current.date.getTime() > latest.date.getTime() ? current : latest
  )
  const hasDownloaded = processed.some((a) => a.status === HentaiArchiveStatus.DownloadSuccess)
  return { archive, hasDownloaded }
}

/**
 * 最近一次写入的行（created_time 最大；upsert 已将其刷新为当前时间）。
 * 仅用于"用户主动跳过"这类必须按操作先后判定的场景，不作为判重水位线。
 */
export function pickLatestOperatedArchive(archives?: HentaiArchiveDto[]): HentaiArchiveDto | null {
  if (!archives || archives.length === 0) return null
  return archives.reduce((latest, current) =>
    current.created_time.getTime() > latest.created_time.getTime() ? current : latest
  )
}

export async function getHentaiArchivesMap(
  gids: number[],
  status?: HentaiArchiveStatus
): Promise<Record<number, HentaiArchiveDto[]>> {
  if (!gids || gids.length === 0) return {}

  const supabase = await useUserStore().getAuthSupabase()

  let query = supabase
    .from('hentai_archive')
    .select('id, gid, date, status, created_time, title, title_hash')
    .in('gid', gids)

  if (status !== undefined) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  const map: Record<number, HentaiArchiveDto[]> = {}
  if (Array.isArray(data)) {
    data.forEach((row: Record<string, unknown>) => {
      const normalized = normalizeArchive(row)
      if (normalized && normalized.gid !== undefined) {
        const gid = Number(normalized.gid)
        if (!map[gid]) {
          map[gid] = []
        }
        map[gid].push(normalized)
      }
    })
  }
  return map
}

export async function getHentaiArchivesMapByHash(
  hashes: string[],
  status?: HentaiArchiveStatus
): Promise<Record<string, HentaiArchiveDto[]>> {
  if (!hashes || hashes.length === 0) return {}

  const supabase = await useUserStore().getAuthSupabase()

  let query = supabase
    .from('hentai_archive')
    .select('id, gid, date, status, created_time, title, title_hash')
    .in('title_hash', hashes)

  if (status !== undefined) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  const map: Record<string, HentaiArchiveDto[]> = {}
  if (Array.isArray(data)) {
    data.forEach((row: Record<string, unknown>) => {
      const normalized = normalizeArchive(row)
      if (normalized && normalized.title_hash) {
        const hash = String(normalized.title_hash)
        if (!map[hash]) {
          map[hash] = []
        }
        map[hash].push(normalized)
      }
    })
  }
  return map
}

export async function getDownloadedArchivesMap(gids: number[]): Promise<Record<number, HentaiArchiveDto[]>> {
  return getHentaiArchivesMap(gids, HentaiArchiveStatus.DownloadSuccess)
}
