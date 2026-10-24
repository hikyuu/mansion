import { LockPool } from '@/common/lock-pool'
import dayjs, { Dayjs } from 'dayjs'
import { FORMAT } from '@/dictionary'
import type { Info } from '@/store/sister-store'
import { SiteId } from '@/site/site-id'
import { read, write } from '@/common/db'

const lockPool = new LockPool()

export async function getHistories(serialNumbers: string[]): Promise<HistoryDto[]> {
  if (serialNumbers.length === 0) return []
  const data = await read<HistoryDto[]>((db) => db.from('browse_history').select().in('serial_number', serialNumbers))
  return data ?? []
}

/** 按路径日期批量取每日统计。缓存不在这里写 —— 调用方拿到行后自行灌 store */
export async function loadDailyHistory(
  pathDates: Set<string> = new Set(),
  siteId: SiteId
): Promise<DailyHistoryDto[]> {
  if (pathDates.size === 0) return []
  const data = await read<DailyHistoryDto[]>((db) =>
    db.from('daily_history').select().in('path_date', Array.from(pathDates)).eq('site', siteId)
  )
  console.log('加载历史记录', data?.length ?? 0)
  return data ?? []
}

/** 按月份区间取每日统计。缓存同上，由调用方灌 */
export async function fetchDailyHistoryRange(monthStart: Dayjs, monthEnd: Dayjs, siteId: SiteId): Promise<DailyHistoryDto[]> {
  const data = await read<DailyHistoryDto[]>((db) =>
    db
      .from('daily_history')
      .select()
      .gte('release_date', monthStart.format('YYYY-MM-DD'))
      .lte('release_date', monthEnd.format('YYYY-MM-DD'))
      .eq('site', siteId)
  )
  console.log('加载月份', monthStart.format('YYYY-MM-DD'), data?.length ?? 0)
  return data ?? []
}

async function uploadRemoteHistory(serialNumber: string, history: HistoryDto): Promise<HistoryDto[]> {
  console.log(`记录`, serialNumber)
  lockPool.lock(serialNumber)
  try {
    const data = await write<HistoryDto[]>((db) =>
      db.from('browse_history').upsert(history, { onConflict: 'serial_number,path_date,site,user_id' }).select()
    )
    console.log(serialNumber, '上传成功')
    return data ?? []
  } finally {
    // 失败也必须解锁，否则该番号后续再也传不上去
    lockPool.unlock(serialNumber)
  }
}

export async function uploadHistory(serialNumber: string, info: Info): Promise<HistoryDto[]> {
  if (lockPool.locked(serialNumber)) throw new Error(`${serialNumber} 正在上传`)

  const parsedDate = dayjs(info.pathDate, FORMAT.PATH_DATE)

  const history = {
    serial_number: serialNumber,
    path_date: info.pathDate,
    release_date: parsedDate.format('YYYY-MM-DD'),
    original_release_date: info.date,
    watch_time: new Date(),
    site: info.site
  } as HistoryDto
  return uploadRemoteHistory(serialNumber, history)
}

/**
 * 拉取自 since 之后新增的浏览历史。
 *
 * 游标由调用方持有：这个模块不再自己记住「上次到哪」——
 * 同一参数必须得到同一查询，否则「今天拉到几条」取决于这个函数被调用过几次。
 */
export async function fetchHistoriesSince(since: Date): Promise<HistoryDto[]> {
  console.log('加载最新记录', since.toISOString())
  const data = await read<HistoryDto[]>((db) =>
    db.from('browse_history').select().gte('watch_time', since.toISOString())
  )
  return data ?? []
}

export declare interface DailyHistoryDto {
  path_date: string
  history_number: number
  release_date: string
  site: SiteId
  [key: string]: unknown
}

export declare interface HistoryDto {
  id: number
  user_id: string
  serial_number: string
  path_date: string
  release_date: string
  original_release_date: string
  watch_time: Date
  site: SiteId //0 unknown 1 onejav 2 javdb 3 javstore
}
