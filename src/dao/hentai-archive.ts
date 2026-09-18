import { useUserStore } from '@/store/user-store'
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

/** upsert_hentai_archive() 的返回行：列名即数据库列名，在此显式映射为 DTO */
interface UpsertArchiveRow {
  id: number
  user_id: string
  gallery_id: number
  status: number
  watermark_date: string
  updated_time: string
  gid: number
  title: string
  title_hash: string
}

export async function upsertHentaiArchive(
  gid: number,
  date: Date,
  status: HentaiArchiveStatus,
  title: string
): Promise<HentaiArchiveDto | null> {
  const supabase = await useUserStore().getAuthSupabase()

  // 代码层约束：title 非空（与数据库 CHECK 对应）
  if (!title) {
    console.warn('hentai_archive: title 为空，拒绝写入', { gid, status })
    return null
  }

  // 写入唯一入口：库函数内原子完成「画廊 upsert + 归档事件 upsert」。
  // - title_hash 统一由库侧 sha256(title) 计算（与前端 sha256Hex 同算法，由触发器守卫生效性）；
  // - updated_time 在库内刷新为 now()，替代原先由前端显式写 created_time 的做法；
  // - 拆表后不再需要前端拼 title/gid 等实体字段。
  const { data, error } = await supabase.rpc('upsert_hentai_archive', {
    p_gid: gid,
    p_title: title,
    p_date: dayjs(date).toISOString(),
    p_status: status
  })
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }

  const row = Array.isArray(data) ? (data[0] as UpsertArchiveRow | undefined) : undefined
  if (!row) return null
  // 归一化为与拆表前完全一致的 DTO 形状，调用方与判重逻辑无需感知底层结构
  return normalizeArchive({
    id: row.id,
    gid: row.gid,
    date: row.watermark_date,
    user_id: row.user_id,
    created_time: row.updated_time,
    status: row.status,
    title: row.title,
    title_hash: row.title_hash
  })
}

/**
 * 归档判重的唯一口径：水位线 = date 最大的已处理记录（200 已下载 / 304 只有过时种子），
 * 400（用户主动跳过）不参与判重。列表页与下载 handler 必须共用本函数，否则两处判定会互相打架。
 *
 * 用 max(date) 而不是 max(created_time)：
 * - 304 记录的 date 是种子日期，200 记录的 date 是画廊日期，两者语义一致、可直接比较；
 * - created_time 只反映写入先后，用它当水位线会把判定锁死在最早写下的那一行。
 */
export function resolveArchiveWaterline(archives?: HentaiArchiveDto[]): HentaiArchiveDto | null {
  const processed = (archives ?? []).filter(
    (a) => a.status === HentaiArchiveStatus.DownloadSuccess || a.status === HentaiArchiveStatus.NoNewerSeed
  )
  if (processed.length === 0) return null
  return processed.reduce((latest, current) => (current.date.getTime() > latest.date.getTime() ? current : latest))
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

/**
 * 按标题 hash 批量查归档。
 *
 * 判重键只有 title_hash：gid 会随画廊更新/重传变动，且 gallery 行上的 gid 是"最近值"，
 * 用旧 gid 查会查不到、用重传后的 gid 查会串到别的 hash 行，因此不再提供按 gid 的读路径。
 * 查询不做 status 过滤：列表页与 handler 的判定都需要 200/304/400 全量（避免两次查库双份真值）。
 */
export async function getHentaiArchivesMapByHash(hashes: string[]): Promise<Record<string, HentaiArchiveDto[]>> {
  if (!hashes || hashes.length === 0) return {}

  const supabase = await useUserStore().getAuthSupabase()

  const { data, error } = await supabase
    .from('hentai_archive')
    .select('id, gid, date, status, created_time, title, title_hash')
    .in('title_hash', hashes)

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
