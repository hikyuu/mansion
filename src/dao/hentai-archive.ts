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
  title?: string
  title_hash?: string
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

  // 处理 title 字段
  if (item.title === undefined || item.title === null) {
    item.title = ''
  } else {
    item.title = String(item.title)
  }

  // 处理 title_hash 字段
  if (item.title_hash === undefined || item.title_hash === null) {
    item.title_hash = ''
  } else {
    item.title_hash = String(item.title_hash)
  }

  return item as HentaiArchiveDto
}

export async function upsertHentaiArchive(
  gid: number,
  date: Date,
  status: HentaiArchiveStatus,
  title?: string
): Promise<HentaiArchiveDto | null> {
  const supabase = await useUserStore().getAuthSupabase()
  const record: Record<string, string | number> = {
    gid,
    date: dayjs(date).toISOString(),
    status: status
  }
  if (title) {
    record.title = title
    const hash = await sha256Hex(title)
    if (hash) {
      record.title_hash = hash
    }
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
