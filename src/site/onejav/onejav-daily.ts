import * as realm from 'realm-web'
import { FORMAT } from '@/dictionary'
import { ref } from 'vue'
import { LockPool } from '@/common/lock-pool'
import dayjs from 'dayjs'

let daily: Realm.Services.MongoDB.MongoDBCollection<OnejavDaily> | undefined = undefined

const lockPool = new LockPool()

let loadingTime = new Date()

export const dailiesRef = ref<Map<string, OnejavDaily>>(new Map())

function getOnejavDaily() {
  if (daily === undefined) {
    const app = realm.App.getApp('mansion-daygh')
    if (app.currentUser === null) {
      console.log('用户未登录')
      throw new Error('用户未登录')
    }
    const mongo = app.currentUser.mongoClient('mongodb-atlas')
    daily = mongo.db('mansion').collection('onejav-daily')
    return daily
  }
  return daily
}

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
    releaseDate: date,
    releaseDateStamp: momentDate.valueOf(),
    originalReleaseDate,
    watchTime: new Date()
  } as OnejavDaily

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

async function updateRemoteDaily(daily: OnejavDaily, retry: number = 3) {
  const onejav = getOnejavDaily()
  console.log('上传每日数据', daily)
  onejav
    .updateOne({ pathDate: daily.pathDate }, daily, { upsert: true })
    .then(() => {
      console.log(daily.pathDate, '上传成功')
      return Promise.resolve()
    })
    .catch((reason) => {
      console.error(reason)
      console.log(daily.pathDate, '上传重试', '重复次数', retry)
      if (retry <= 0) {
        return Promise.reject('重试次数用尽')
      }
      return updateRemoteDaily(daily, --retry)
    })
}

export async function loadDailies() {
  loadingTime = new Date()
  getOnejavDaily()
    .find({})
    .then((result) => {
      for (const onejavDaily of result) {
        if (isNaN(Date.parse(onejavDaily.pathDate))) {
          console.log('删除', onejavDaily.pathDate, '不是日期')
          getOnejavDaily().deleteOne({ _id: onejavDaily._id })
        }
        dailiesRef.value.set(onejavDaily.pathDate, onejavDaily)
      }
    })
}

export function loadLatestDailies() {}

function updateOrAddDaily(daily: OnejavDaily) {
  // 查找数组中是否有匹配的对象
  dailiesRef.value.set(daily.pathDate, daily)
}

export declare interface OnejavDaily {
  _id: string
  sisterNumber: number
  //是否加载完成
  loadCompleted: boolean
  pathDate: string
  releaseDate: Date
  releaseDateStamp: number
  originalReleaseDate: string
  watchTime: Date
  [key: string]: any
}
