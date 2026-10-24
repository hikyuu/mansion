import { LockPool } from '@/common/lock-pool'
import { computed, ref } from 'vue'
import dayjs, { type Dayjs } from 'dayjs'
import { FORMAT } from '@/dictionary'
import { fetchDailyHistoryRange } from '@/dao/browse-history'
import { useDailyHistoryStore } from '@/store/daily-history-store'
import { SiteId } from '@/site/site-id'
import { read, write } from '@/common/db'

const lockPool = new LockPool()

const ONEJAV_DAILY = 'onejav_daily'

const dailiesRef = ref<Map<string, onejav_daily_dto>>(new Map())

export async function uploadDaily(path_date: string, sister_number: number, load_completed: boolean) {
  if (isNaN(Date.parse(path_date))) {
    console.log('路径不是日期')
    return
  }
  if (lockPool.locked(path_date)) return

  lockPool.lock(path_date)
  try {
    console.log(`记录`, path_date)
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
    await write((db) => db.from(ONEJAV_DAILY).upsert(daily, { onConflict: 'path_date,user_id' }).select())
    console.log(path_date, '上传成功')
    upsertDaily(daily)
  } catch (error) {
    console.error(error)
  } finally {
    // 失败也必须解锁，否则该日期后续再也传不上去
    lockPool.unlock(path_date)
  }
}

const dailyLock = new LockPool()
const loadedMonth = new Set<string>()

/**
 * 确保这个月的两套数据都拉过：单日汇总行（onejav_daily）与每日统计数字（daily_history）。
 * 幂等：已加载过、或正在加载，直接返回。
 * 只有两半都成功才记「本月已加载」，任一半失败下次会整月重试。
 */
async function ensureMonthLoaded(monthStart: Dayjs, siteId: SiteId): Promise<void> {
  const key = monthStart.toString()
  if (loadedMonth.has(key)) return
  if (dailyLock.locked(key)) return

  dailyLock.lock(key)
  try {
    const monthEnd = monthStart.endOf('month')
    const [, dailyRows] = await Promise.all([
      fetchDailyRange(monthStart, monthEnd),
      fetchDailyHistoryRange(monthStart, monthEnd, siteId)
    ])
    loadedMonth.add(key)
    useDailyHistoryStore().fill(dailyRows)
  } finally {
    dailyLock.unlock(key)
  }
}

/**
 * 取某一天的汇总行。
 * 「单日行有没有缓存」与「本月计数拉没拉过」是两套数据 —— 前者命中不代表后者已就绪，
 * 所以这里不做任何短路，先确保本月加载完，再回答这一天。
 */
export async function fetchDailyByPathDate(pathDate: string, siteId: SiteId): Promise<onejav_daily_dto | undefined> {
  const day = dayjs(pathDate, FORMAT.PATH_DATE)
  if (!day.isValid()) {
    console.error('日期格式错误', pathDate)
    return Promise.reject('日期格式错误')
  }

  await ensureMonthLoaded(day.startOf('month'), siteId)
  return dailiesRef.value.get(pathDate)
}

async function fetchDailyRange(monthStart: Dayjs, monthEnd: Dayjs) {
  const data = await read<onejav_daily_dto[]>((db) =>
    db
      .from(ONEJAV_DAILY)
      .select()
      .gte('release_date', monthStart.format('YYYY-MM-DD'))
      .lte('release_date', monthEnd.format('YYYY-MM-DD'))
  )
  console.log('加载月份', monthStart.format('YYYY-MM-DD'), data?.length ?? 0)
  for (const onejavDaily of data ?? []) {
    upsertDaily(onejavDaily)
  }
  return data ?? []
}

export async function fetchRecentDaily(numberOfDays: number): Promise<onejav_daily_dto[]> {
  const data = await read<onejav_daily_dto[]>((db) =>
    db.from(ONEJAV_DAILY).select().limit(numberOfDays).order('watch_time', { ascending: false })
  )
  for (const onejavDaily of data ?? []) {
    upsertDaily(onejavDaily)
  }
  return data ?? []
}

/**
 * 同步读缓存，同时补一次月度加载 —— 单日行已缓存时也要补，否则本月计数永远拉不下来。
 * 月度加载由 ensureMonthLoaded 的幂等守卫兜住，逐格调用不会打出重复请求。
 */
export function getDailyByPathDate(pathDate: string, siteId: SiteId): onejav_daily_dto | undefined {
  fetchDailyByPathDate(pathDate, siteId)
    .then()
    .catch((error) => console.error('加载每日汇总失败', pathDate, error))
  return dailiesRef.value.get(pathDate)
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

/** 退出登录时清空：连「哪些月份已加载」一起清，否则换账号后那几个月永远不再拉 */
export function clearDailies() {
  dailiesRef.value.clear()
  loadedMonth.clear()
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
  [key: string]: unknown
}
