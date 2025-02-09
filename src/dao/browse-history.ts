import { ElNotification } from 'element-plus'
import { LockPool } from '@/common/lock-pool'
import dayjs, { Dayjs } from 'dayjs'
import { FORMAT } from '@/dictionary'
import { reactive } from 'vue'
import { useUserStore } from '@/store/user-store'
import type { Info } from '@/store/sister-store'

const refreshTime = new Date()

const lockPool = new LockPool()

export const dailyNumberRef: Map<string, number> = reactive(new Map())

export async function getHistories(serialNumbers: string[]): Promise<HistoryDto[]> {
  if (serialNumbers.length === 0) {
    return Promise.resolve([])
  }
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase.from('browse_history').select().in('serial_number', serialNumbers)
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  return data
}

export async function loadDailyHistory(pathDates: Set<string> = new Set(), siteId: number) {
  if (pathDates.size === 0) {
    return Promise.resolve([])
  }
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase
    .from('daily_history')
    .select()
    .in('path_date', Array.from(pathDates))
    .eq('site', siteId)

  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  console.log('加载历史记录', data.length)
  for (const history of data) {
    dailyNumberRef.set(history.path_date, history.history_number)
  }
  return data
}

export async function fetchDailyHistoryRange(monthStart: Dayjs, monthEnd: Dayjs, siteId: number) {
  const supabase = await useUserStore().getAuthSupabase()
  console.log('siteId', siteId)
  const { data, error } = await supabase
    .from('daily_history')
    .select()
    .gte('release_date', monthStart.format('YYYY-MM-DD'))
    .lte('release_date', monthEnd.format('YYYY-MM-DD'))
    .eq('site', siteId)
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  console.log('加载月份', monthStart.format('YYYY-MM-DD'), data.length)
  // console.log(data)
  for (const history of data) {
    dailyNumberRef.set(history.path_date, history.history_number)
  }
  return data
}

async function uploadRemoteHistory(
  serialNumber: string,
  history: HistoryDto,
  retry: number = 3
): Promise<HistoryDto[]> {
  console.log(`记录`, serialNumber)
  lockPool.lock(serialNumber)
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase
    .from('browse_history')
    .upsert(history, { onConflict: 'serial_number,path_date,site,user_id' })
    .select()
  if (error) {
    console.error(error)
    console.log(history.serial_number, '上传重试', '重复次数', retry)
    if (retry <= 0) {
      ElNotification.error({
        title: '远程上传失败！',
        message: `${serialNumber}上传失败，重试次数用尽`
      })
      return Promise.reject('重试次数用尽')
    }
    return uploadRemoteHistory(serialNumber, history, --retry)
  }
  console.log(serialNumber, '上传成功')
  //解锁
  lockPool.unlock(serialNumber)
  return Promise.resolve(data)
}
export async function uploadHistory(serialNumber: string, info: Info): Promise<HistoryDto[]> {
  if (lockPool.locked(serialNumber)) return Promise.reject()

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

export async function loadLatestHistory(): Promise<HistoryDto[]> {
  console.log('加载最新记录')
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase.from('browse_history').select().gte('watch_time', refreshTime.toISOString())

  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  refreshTime.setTime(new Date().getTime())
  return data
}

export function clearHistory() {
  dailyNumberRef.clear()
}

export declare interface HistoryDto {
  id: number
  user_id: string
  serial_number: string
  path_date: string
  release_date: string
  original_release_date: string
  watch_time: Date
  site: number //0 unknown 1 onejav 2 javdb
}
