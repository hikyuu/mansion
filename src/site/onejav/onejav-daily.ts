import MongoDBCollection = Realm.Services.MongoDB.MongoDBCollection
import { LockPool } from '../site-abstract'
import moment from 'moment'
import { FORMAT, KEY } from '@/dictionary'
import * as realm from 'realm-web'
import { ref } from 'vue'
import { GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client'

let daily: MongoDBCollection<OnejavDaily> | undefined = undefined

const lockPool = new LockPool()

export const dailiesRef = ref<OnejavDaily[]>([])

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

export async function uploadDaily(
  pathDate: string,
  sisterNumber: number,
  loadCompleted: boolean,
  retry = 3
) {
  if (isNaN(Date.parse(pathDate))) {
    console.log('路径不是日期')
    return
  }
  if (lockPool.locked(pathDate)) return

  console.log(`记录`, pathDate)
  lockPool.lock(pathDate)
  const momentDate = moment(pathDate, FORMAT.PATH_DATE)
  const date = momentDate.toDate()
  const originalReleaseDate = momentDate.format(FORMAT.ORIGINAL_RELEASE_DATE).toString()
  const daily = {
    sisterNumber,
    loadCompleted,
    pathDate,
    releaseDate: date,
    releaseDateStamp: momentDate.valueOf(),
    originalReleaseDate,
    watchTime: new Date()
  } as OnejavDaily

  const onejav = getOnejavDaily()
  console.log('上传每日数据')
  onejav
    .updateOne({ pathDate }, daily, { upsert: true })
    .then(() => {
      console.log(pathDate, '上传成功')
      updateOrAddDaily(daily)
      //解锁
      lockPool.unlock(pathDate)
    })
    .catch((reason) => {
      console.error(reason)
      console.log(pathDate, '上传重试')
      lockPool.unlock(pathDate)
      console.log('日期上传重复次数', retry)
      if (retry <= 0) {
        return Promise.reject('重试次数用尽')
      }
      return uploadDaily(pathDate, sisterNumber, loadCompleted, --retry)
    })
}

export async function loadDailies() {
  const value = dailiesRef.value
  getOnejavDaily()
    .find({})
    .then((result) => {
      for (const onejavDaily of result) {
        if (isNaN(Date.parse(onejavDaily.pathDate))) {
          console.log('删除', onejavDaily.pathDate, '不是日期')
          getOnejavDaily().deleteOne({ _id: onejavDaily._id })
        }
        dailiesRef.value = result
      }
    })
  setDailies(value)
}

export function loadLocalDailies() {
  dailiesRef.value = GM_getValue<OnejavDaily[]>(KEY.ONEJAV_DAILY_KEY, [])
}

export function setDailies(dailies: OnejavDaily[]) {
  console.log('日期记录写入本地')
  GM_setValue(KEY.ONEJAV_DAILY_KEY, dailies)
}

function updateOrAddDaily(daily: OnejavDaily) {
  // 查找数组中是否有匹配的对象
  const dailies_value = dailiesRef.value
  const index = dailies_value.findIndex((item: OnejavDaily) => item.pathDate === daily.pathDate)
  if (index >= 0) {
    // 如果有，就更新该对象
    dailies_value[index] = daily
  } else {
    // 如果没有，就新增该对象
    dailies_value.push(daily)
  }
  setDailies(dailies_value)
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
