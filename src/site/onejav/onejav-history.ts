import { RealmTask } from '../realm-task'
import * as realm from 'realm-web'
import { LockPool } from '@/common/lock-pool'
import { reactive } from 'vue'

new RealmTask()
let onejav: Realm.Services.MongoDB.MongoDBCollection<History> | undefined = undefined
new Date()
new LockPool()
reactive(new Map())
export async function fetchAllHistory(pageSize: number, lastId: any) {
  const query = lastId ? { _id: { $gt: lastId } } : {}
  return getOnejavHistory()
    .find(query, { limit: pageSize })
    .then((histories: History[]) => {
      return histories
    })
}
export function getOnejavHistory() {
  if (onejav === undefined) {
    const app = realm.App.getApp('mansion-daygh')
    if (app.currentUser === null) {
      console.log('用户未登录')
      throw new Error('用户未登录')
    }
    const mongo = app.currentUser.mongoClient('mongodb-atlas')
    onejav = mongo.db('mansion').collection('onejav')
    return onejav
  }
  return onejav
}
export declare interface History {
  _id: string
  serialNumber: string
  pathDate: string
  releaseDate: Date
  originalReleaseDate: string
  watchTime: Date
  [key: string]: any
}
