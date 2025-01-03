import * as realm from 'realm-web'
import { ref } from 'vue'
import type { onejav_daily_dto } from '@/dao/onejav-daily-dao'
import dayjs from 'dayjs'

let daily: Realm.Services.MongoDB.MongoDBCollection<OnejavDaily> | undefined = undefined
ref<Map<string, OnejavDaily>>(new Map())
export async function getDailies(limit: number = 0) {
  const options = {} as any
  if (limit > 0) {
    options.limit = limit
  }

  const onejavDailies = await getOnejavDaily().find({}, options)
  console.log('查询结果：', onejavDailies)

  const dtos = onejavDailies.map((daily) => {
    return {
      sister_number: daily.sisterNumber,
      load_completed: daily.loadCompleted,
      path_date: daily.pathDate,
      original_release_date: daily.originalReleaseDate,
      watch_time: daily.watchTime
    } as onejav_daily_dto
  })
  return dtos
}

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
