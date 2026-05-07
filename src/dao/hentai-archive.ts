import { useUserStore } from '@/store/user-store'

export declare interface HentaiArchiveDto {
  id: number
  gid: number
  date: Date
  user_id: string
  created_time: Date
  [key: string]: any
}

function normalizeArchive(item: any): HentaiArchiveDto {
  if (!item) return item
  item.date = item.date ? new Date(item.date) : new Date()
  item.created_time = item.created_time ? new Date(item.created_time) : new Date()
  return item as HentaiArchiveDto
}

export async function upsertHentaiArchive(gid: number, date?: Date): Promise<HentaiArchiveDto | null> {
  const supabase = await useUserStore().getAuthSupabase()
  const record = {
    gid,
    date: date ? date.toISOString() : new Date().toISOString()
  }
  const { data, error } = await supabase.from('hentai_archive').upsert(record, { onConflict: 'gid' }).select()
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  if (Array.isArray(data) && data.length > 0) {
    return normalizeArchive(data[0])
  }
  return null
}

export async function getHentaiArchivesByGids(gids: number[]): Promise<Record<number, HentaiArchiveDto>> {
  if (!gids || gids.length === 0) return {}
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase.from('hentai_archive').select('gid, date').in('gid', gids)
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  const map: Record<number, HentaiArchiveDto> = {}
  if (Array.isArray(data)) {
    data.forEach((row: any) => {
      const normalized = normalizeArchive(row)
      if (normalized && normalized.gid !== undefined) {
        map[Number(normalized.gid)] = normalized
      }
    })
  }
  return map
}
