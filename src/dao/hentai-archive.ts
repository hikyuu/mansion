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

  return item as HentaiArchiveDto
}

export async function upsertHentaiArchive(
  gid: number,
  date: Date,
  status: HentaiArchiveStatus
): Promise<HentaiArchiveDto | null> {
  const supabase = await useUserStore().getAuthSupabase()
  const record: Record<string, string | number> = {
    gid,
    date: dayjs(date).toISOString(),
    status: status
  }
  const { data, error } = await supabase
    .from('hentai_archive')
    .upsert(record, { onConflict: 'gid,status,user_id' })
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

  let query = supabase.from('hentai_archive').select('gid, date, status').in('gid', gids)

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

export async function getDownloadedArchivesMap(gids: number[]): Promise<Record<number, HentaiArchiveDto[]>> {
  return getHentaiArchivesMap(gids, HentaiArchiveStatus.DownloadSuccess)
}
