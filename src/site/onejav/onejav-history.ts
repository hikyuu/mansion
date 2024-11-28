import { RealmTask } from '../realm-task'
import { FORMAT } from '@/dictionary'
import * as realm from 'realm-web'
import type { Info } from '@/site/sisters'
import { LockPool } from '@/common/lock-pool'
import dayjs from 'dayjs'
import { ElNotification } from 'element-plus'
import { reactive } from 'vue'

new RealmTask()
let onejav: Realm.Services.MongoDB.MongoDBCollection<History> | undefined = undefined

export const refreshTime = new Date()
const lockPool = new LockPool()

export const dailyNumberRef: Map<string, number> = reactive(new Map())

export async function loadHistoryNumber(pathDates: Set<string> = new Set()) {
  const onejav = getOnejavHistory()
  const pipeline = [
    {
      $group: {
        _id: '$pathDate',
        history_number: {
          $sum: 1
        }
      }
    }
  ] as any[]
  if (pathDates.size > 0) {
    pipeline.unshift({
      $match: {
        pathDate: {
          $in: Array.from(pathDates)
        }
      }
    })
  }
  return onejav.aggregate(pipeline).then((histories: any) => {
    console.log('加载历史记录', histories.length)
    for (const history of histories) {
      dailyNumberRef.set(history._id, history.history_number)
    }
    return histories
  })
}

export async function getHistories(serialNumber: string) {
  const onejav = getOnejavHistory()
  return onejav.find({ serialNumber: serialNumber }).then((history: History[]) => {
    return history
  })
}

export async function loadLatestHistory() {
  console.log('加载最新记录')
  const onejav = getOnejavHistory()
  return onejav.find({ watchTime: { $gte: refreshTime } }).then((histories: History[]) => {
    refreshTime.setTime(new Date().getTime())
    if (histories.length > 0) {
      console.log(`添加${histories.length}条数据`)
      ElNotification.success({
        title: '加载最新记录',
        message: `添加${histories.length}条浏览记录`
      })
    }
    return histories
  })
}

const work = async (history: History) => {
  const date = dayjs(history.originalReleaseDate, FORMAT.ORIGINAL_RELEASE_DATE)
  const pathDate = date.format(FORMAT.PATH_DATE)
  const releaseDate = date.toDate()
  try {
    await getOnejavHistory().updateOne(
      { _id: history._id },
      {
        $set: {
          pathDate: pathDate,
          releaseDate: releaseDate
        }
      }
    )
    console.log('更新成功', history.serialNumber)
  } catch (reason) {
    console.log('更新失败', history.serialNumber, reason)
  }
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

async function uploadRemoteHistory(serialNumber: string, history: History, retry: number = 3): Promise<History> {
  try {
    onejav = getOnejavHistory()
    await onejav.updateOne({ serialNumber: serialNumber, pathDate: history.pathDate }, history, { upsert: true })
    console.log(serialNumber, '上传成功')

    //解锁
    lockPool.unlock(serialNumber)
    return Promise.resolve(history)
  } catch (reason) {
    console.error(reason)
    ElNotification.error({
      title: '远程上传失败！',
      message: `${serialNumber}上传失败，重试中`
    })
    lockPool.unlock(serialNumber)
    console.log('历史上传重复次数', retry)
    if (retry <= 0) {
      ElNotification.error({
        title: '远程上传失败！',
        message: `${serialNumber}上传失败，重试次数用尽`
      })
      return Promise.reject('重试次数用尽')
    }
    return uploadRemoteHistory(serialNumber, history, --retry)
  }
}

export async function uploadHistory(serialNumber: string, info: Info): Promise<History> {
  if (lockPool.locked(serialNumber)) return Promise.reject()

  console.log(`记录`, serialNumber)
  lockPool.lock(serialNumber)

  const parsedDate = dayjs(info.pathDate, FORMAT.PATH_DATE)
  const date = parsedDate.toDate()

  const history = {
    serialNumber: serialNumber,
    releaseDate: date,
    originalReleaseDate: info.date,
    pathDate: info.pathDate,
    watchTime: new Date()
  } as History
  return uploadRemoteHistory(serialNumber, history)
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
