import { useUserStore } from '@/store/user-store'

export enum HentaiArchiveStatus {
  DownloadSuccess = 200,
  NoNewerSeed = 304 // 没有更新的种子即过时
}

export declare interface HentaiArchiveDto {
  id: number
  gid: number
  date: Date
  user_id: string
  created_time: Date
  status: HentaiArchiveStatus
  [key: string]: any
}

function normalizeArchive(item: any): HentaiArchiveDto {
  if (!item) return item
  item.date = item.date ? new Date(item.date) : new Date()
  item.created_time = item.created_time ? new Date(item.created_time) : new Date()
  const statusNum = Number(item.status)
  if (statusNum === HentaiArchiveStatus.NoNewerSeed) {
    item.status = HentaiArchiveStatus.NoNewerSeed
  } else {
    item.status = HentaiArchiveStatus.DownloadSuccess
  }
  return item as HentaiArchiveDto
}

export async function upsertHentaiArchive(
  gid: number,
  date?: Date,
  status?: HentaiArchiveStatus
): Promise<HentaiArchiveDto | null> {
  const supabase = await useUserStore().getAuthSupabase()
  const record: Record<string, any> = {
    gid,
    date: date ? date.toISOString() : new Date().toISOString(),
    status: status !== undefined ? status : HentaiArchiveStatus.DownloadSuccess
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

  let query = supabase
    .from('hentai_archive')
    .select('gid, date, status')
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
    data.forEach((row: any) => {
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
