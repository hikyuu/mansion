import { RealmTask } from '../realm-task'
import { GM_setValue } from '$'
import { FORMAT, KEY } from '@/dictionary'
import * as realm from 'realm-web'
import { GM_getValue } from 'vite-plugin-monkey/dist/client'
import type { Info } from '@/site/sisters'
import { LockPool } from '@/common/lock-pool'
import dayjs from 'dayjs'

const realmTask: RealmTask = new RealmTask()

let onejav: Realm.Services.MongoDB.MongoDBCollection<History> | undefined = undefined

const lockPool = new LockPool()
//数据可能会很多不要滥用响应式
export let historySerialNumbers: Map<string, History> = new Map()

export async function loadRemoteHistory() {
  const onejav = getOnejavHistory()
  const remoteHistories = await onejav.find()
  let countFix = 0
  let countRemote = 0
  for (const history of remoteHistories) {
    //Aug. 24, 2023
    if (!history.pathDate || history.pathDate.length <= 0) {
      countFix++
      console.log('修复数据', history.serialNumber)
      realmTask.addTask(history, work)
    }
    if (!historySerialNumbers.has(history.serialNumber)) {
      console.log('添加远程数据')
      historySerialNumbers.set(history.serialNumber, history)
      countRemote++
    }
  }
  if (countFix > 0) {
    console.log(`修复${countFix}条数据`)
  }
  if (countRemote > 0) {
    console.log(`添加${countRemote}条数据`)
  }
  setLocalHistory()
}

export function loadLocalHistory() {
  const json = GM_getValue(KEY.ONEJAV_HISTORY_KEY, {})
  historySerialNumbers = new Map(Object.entries(json))
  let count = 0
  historySerialNumbers.forEach((value, key) => {
    if (key !== value.serialNumber) {
      historySerialNumbers.delete(key)
      count++
    }
  })
  if (count > 0) {
    console.log(`清理${count}条数据`)
    setLocalHistory()
  }
  console.log('本地历史记录', historySerialNumbers)
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

async function uploadRemoteHistory(serialNumber: string, history: History, retry: number = 3): Promise<void> {
  try {
    onejav = getOnejavHistory()
    await onejav.updateOne({ serialNumber: serialNumber }, history, { upsert: true } as any)
    console.log(serialNumber, '上传成功')
    historySerialNumbers.set(history.serialNumber, history)
    // setLocalHistory()
    //解锁
    lockPool.unlock(serialNumber)
    return Promise.resolve()
  } catch (reason) {
    console.error(reason)
    lockPool.unlock(serialNumber)
    console.log('历史上传重复次数', retry)
    if (retry <= 0) {
      return Promise.reject('重试次数用尽')
    }
    return uploadRemoteHistory(serialNumber, history, --retry)
  }
}

export async function uploadHistory(serialNumber: string, info: Info) {
  if (lockPool.locked(serialNumber)) return Promise.resolve()

  console.log(`记录`, serialNumber)
  lockPool.lock(serialNumber)

  const DateClass = dayjs(info.pathDate, FORMAT.PATH_DATE)
  const date = DateClass.toDate()

  const history = {
    serialNumber: serialNumber,
    releaseDate: date,
    originalReleaseDate: info.date,
    pathDate: info.pathDate,
    watchTime: new Date()
  } as History
  // console.log(history);
  return uploadRemoteHistory(serialNumber, history)
}

export function setLocalHistory() {
  GM_setValue(KEY.ONEJAV_HISTORY_KEY, Object.fromEntries(historySerialNumbers))
  console.log('历史记录写入本地')
}

export function getTodayHistories(pathDate: string) {
  return Array.from(historySerialNumbers).filter(([key, history]) => history.pathDate === pathDate)
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
