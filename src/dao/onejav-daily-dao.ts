import { LockPool } from '@/common/lock-pool'
import { computed, ref } from 'vue'
import { supabase } from '@/dao/archive'
import dayjs, { type Dayjs } from 'dayjs'
import { FORMAT } from '@/dictionary'
import { loadDailyHistory, fetchDailyHistoryRange } from '@/dao/browse-history'

const lockPool = new LockPool()

let loadingTime = new Date()

const dailiesRef = ref<Map<string, OnejavDailyDto>>(new Map())
export async function uploadDaily(pathDate: string, sisterNumber: number, loadCompleted: boolean, retry = 3) {
  if (isNaN(Date.parse(pathDate))) {
    console.log('路径不是日期')
    return
  }
  if (lockPool.locked(pathDate)) return

  console.log(`记录`, pathDate)
  lockPool.lock(pathDate)
  const momentDate = dayjs(pathDate, FORMAT.PATH_DATE)
  const date = momentDate.toDate()
  const originalReleaseDate = momentDate.format(FORMAT.ORIGINAL_RELEASE_DATE)
  const daily = {
    sisterNumber,
    loadCompleted,
    pathDate,
    releaseDate: momentDate.format('YYYY-MM-DD'),
    releaseDateStamp: momentDate.valueOf(),
    originalReleaseDate,
    watchTime: new Date()
  } as OnejavDailyDto

  updateRemoteDaily(daily, retry)
    .then(() => {
      updateOrAddDaily(daily)
      //解锁
      lockPool.unlock(daily.pathDate)
    })
    .catch((reason) => {
      console.error(reason)
      lockPool.unlock(daily.pathDate)
    })
}
const dailyLock = new LockPool()
const loadedMonth = new Set<string>()

export async function fetchDailyByPathDate(pathDate: string): Promise<OnejavDailyDto | undefined> {
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
  const { data, error } = await supabase
    .from('onejav-daily')
    .select()
    .gte('releaseDate', monthStart.format('YYYY-MM-DD'))
    .lte('releaseDate', monthEnd.format('YYYY-MM-DD'))
  console.log('加载月份', monthStart.format('YYYY-MM-DD'), data?.length)
  // console.log(data)
  if (error) {
    return Promise.reject(error)
  }
  loadedMonth.add(monthStart.toString())
  for (const onejavDaily of data) {
    updateOrAddDaily(onejavDaily)
  }
  return data
}

export async function fetchRecentDaily(numberOfDays: number): Promise<any[]> {
  const { data, error } = await supabase
    .from('onejav-daily')
    .select()
    .limit(numberOfDays)
    .order('watchTime', { ascending: false })
  if (error) {
    console.error(error)
    return Promise.reject(error)
  }
  for (const onejavDaily of data) {
    updateOrAddDaily(onejavDaily)
  }
  return data
}

export function getDailyByPathDate(pathDate: string): OnejavDailyDto | undefined {
  const daily = dailiesRef.value.get(pathDate)
  if (!daily) {
    fetchDailyByPathDate(pathDate).then().catch()
  }
  return daily
}

async function updateRemoteDaily(daily: OnejavDailyDto, retry: number = 3) {
  console.log('上传每日数据', daily)

  const { data, error } = await supabase.from('onejav-daily').upsert(daily, { onConflict: 'pathDate' }).select()
  if (error) {
    console.error(error)
    console.log(daily.pathDate, '上传重试', '重复次数', retry)
    if (retry <= 0) {
      return Promise.reject('重试次数用尽')
    }
    return updateRemoteDaily(daily, --retry)
  }
  console.log(daily.pathDate, '上传成功')
  return Promise.resolve(data)
}

export async function loadDailies() {
  loadingTime = new Date()
  // const dailies = await getDailies()
  // await upsertBulkDailies(dailies)
  supabase
    .from('onejav-daily')
    .select()
    .then(({ data, error }) => {
      if (error) {
        console.error(error)
        return
      }
      for (const onejavDaily of data) {
        if (isNaN(Date.parse(onejavDaily.pathDate))) {
          console.log('删除', onejavDaily.pathDate, '不是日期')
          supabase.from('onejav-daily').delete().eq('pathDate', onejavDaily.pathDate)
          continue
        }
        updateOrAddDaily(onejavDaily)
      }
    })
}

export const recentHistories = computed(() => {
  return Array.from(dailiesRef.value.values())
    .sort((a, b) => {
      return b.watchTime.getTime() - a.watchTime.getTime()
    })
    .slice(0, 10)
})

function updateOrAddDaily(onejavDaily: OnejavDailyDto) {
  onejavDaily.watchTime = new Date(onejavDaily.watchTime)
  dailiesRef.value.set(onejavDaily.pathDate, onejavDaily)
}

export async function upsertBulkDailies(dailies: OnejavDailyDto[]) {
  const { data, error } = await supabase.from('onejav-daily').upsert(dailies, { onConflict: 'pathDate' })
  if (error) {
    console.error(error.message)
  }
  console.log(data)
}

export function loadLatestDailies() {}

export declare interface OnejavDailyDto {
  id: number
  sisterNumber: number
  //是否加载完成
  loadCompleted: boolean
  pathDate: string
  releaseDate: string
  releaseDateStamp: number
  originalReleaseDate: string
  watchTime: Date
  [key: string]: any
}
