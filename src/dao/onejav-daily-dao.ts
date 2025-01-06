import { LockPool } from '@/common/lock-pool'
import { computed, ref } from 'vue'
import dayjs, { type Dayjs } from 'dayjs'
import { FORMAT } from '@/dictionary'
import { fetchDailyHistoryRange } from '@/dao/browse-history'
import { useUserStore } from '@/store/user-store'

const lockPool = new LockPool()

let loadingTime = new Date()

const ONEJAV_DAILY = 'onejav_daily'

const dailiesRef = ref<Map<string, onejav_daily_dto>>(new Map())
export async function uploadDaily(path_date: string, sister_number: number, load_completed: boolean, retry = 3) {
  if (isNaN(Date.parse(path_date))) {
    console.log('路径不是日期')
    return
  }
  if (lockPool.locked(path_date)) return

  console.log(`记录`, path_date)
  lockPool.lock(path_date)
  const momentDate = dayjs(path_date, FORMAT.PATH_DATE)
  const original_release_date = momentDate.format(FORMAT.ORIGINAL_RELEASE_DATE)
  const daily = {
    sister_number,
    load_completed,
    path_date,
    release_date: momentDate.format('YYYY-MM-DD'),
    original_release_date,
    watch_time: new Date()
  } as onejav_daily_dto

  updateRemoteDaily(daily, retry)
    .then(() => {
      upsertDaily(daily)
      //解锁
      lockPool.unlock(daily.path_date)
    })
    .catch((reason) => {
      console.error(reason)
      lockPool.unlock(daily.path_date)
    })
}
const dailyLock = new LockPool()
const loadedMonth = new Set<string>()

export async function fetchDailyByPathDate(pathDate: string): Promise<onejav_daily_dto | undefined> {
  let daily = dailiesRef.value.get(pathDate)
  if (daily) {
    return daily
  }
  const day = dayjs(pathDate, FORMAT.PATH_DATE)
  if (!day.isValid()) {
    console.error('日期格式错误', pathDate)
    return Promise.reject('日期格式错误')
  }
  const monthStart = day.startOf('month')
  if (loadedMonth.has(monthStart.toString())) {
    return Promise.resolve(undefined)
  }
  if (dailyLock.locked(monthStart.toString())) {
    return Promise.resolve(undefined)
  }
  dailyLock.lock(monthStart.toString())
  const monthEnd = day.endOf('month')

  const result = await Promise.all([
    fetchDailyRange(monthStart, monthEnd),
    fetchDailyHistoryRange(monthStart, monthEnd)
  ])

  dailyLock.unlock(monthStart.toString())
  daily = dailiesRef.value.get(pathDate)
  if (!daily) {
    return Promise.resolve(undefined)
  }
  return daily
}

async function fetchDailyRange(monthStart: Dayjs, monthEnd: Dayjs) {
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase
    .from(ONEJAV_DAILY)
    .select()
    .gte('release_date', monthStart.format('YYYY-MM-DD'))
    .lte('release_date', monthEnd.format('YYYY-MM-DD'))
  console.log('加载月份', monthStart.format('YYYY-MM-DD'), data?.length)
  // console.log(data)
  if (error) {
    return Promise.reject(error)
  }
  loadedMonth.add(monthStart.toString())
  for (const onejavDaily of data) {
    upsertDaily(onejavDaily)
  }
  return data
}

export async function fetchRecentDaily(numberOfDays: number): Promise<any[]> {
  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase
    .from(ONEJAV_DAILY)
    .select()
    .limit(numberOfDays)
    .order('watch_time', { ascending: false })
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  for (const onejavDaily of data) {
    upsertDaily(onejavDaily)
  }
  return data
}

export function getDailyByPathDate(pathDate: string): onejav_daily_dto | undefined {
  const daily = dailiesRef.value.get(pathDate)
  if (!daily) {
    fetchDailyByPathDate(pathDate).then().catch()
  }
  return daily
}

async function updateRemoteDaily(daily: onejav_daily_dto, retry: number = 3) {
  console.log('上传每日数据', daily)

  const supabase = await useUserStore().getAuthSupabase()
  const { data, error } = await supabase.from(ONEJAV_DAILY).upsert(daily, { onConflict: 'path_date,user_id' }).select()
  if (error) {
    console.error(error)
    console.log(daily.path_date, '上传重试', '重复次数', retry)
    if (retry <= 0) {
      return Promise.reject('重试次数用尽')
    }
    return updateRemoteDaily(daily, --retry)
  }
  console.log(daily.path_date, '上传成功')
  return Promise.resolve(data)
}

export async function loadDailies() {
  loadingTime = new Date()
  const supabase = await useUserStore().getAuthSupabase()
  await supabase
    .from(ONEJAV_DAILY)
    .select()
    .then(({ data, error }) => {
      if (error) {
        console.error(error)
        return
      }
      for (const onejavDaily of data as onejav_daily_dto[]) {
        if (isNaN(Date.parse(onejavDaily.path_date))) {
          console.log('删除', onejavDaily.path_date, '不是日期')
          supabase.from(ONEJAV_DAILY).delete().eq('path_date', onejavDaily.pathDate)
          continue
        }
        upsertDaily(onejavDaily)
      }
    })
}

export const recentHistories = computed(() => {
  return Array.from(dailiesRef.value.values())
    .sort((a, b) => {
      return b.watch_time.getTime() - a.watch_time.getTime()
    })
    .slice(0, 10)
})

function upsertDaily(onejavDaily: onejav_daily_dto) {
  onejavDaily.watch_time = new Date(onejavDaily.watch_time)
  dailiesRef.value.set(onejavDaily.path_date, onejavDaily)
}
export function loadLatestDailies() {}

export function clearDailies() {
  dailiesRef.value.clear()
}

export declare interface onejav_daily_dto {
  id: number
  user_id: string
  sister_number: number
  //是否加载完成
  load_completed: boolean
  path_date: string
  release_date: string
  original_release_date: string
  watch_time: Date
  [key: string]: any
}
