import { defineStore } from 'pinia'
import type { TaskFileMeta } from '@hikyuu/thunder-client'

export interface FileSelectionPayload {
  /** 种子/任务名，展示在弹窗标题 */
  name: string
  /** needsSelection 返回的必要元数据清单 */
  files: TaskFileMeta[]
}

interface PendingRequest extends FileSelectionPayload {
  resolve: (indexes: number[] | null) => void
}

/** 视频容器扩展名（小写）；弹窗默认勾选命中这些扩展名的文件 */
const VIDEO_EXTENSIONS = new Set([
  '3g2',
  '3gp',
  'asf',
  'avi',
  'divx',
  'f4v',
  'flv',
  'm2ts',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
  'mts',
  'ogv',
  'rm',
  'rmvb',
  'ts',
  'vob',
  'webm',
  'wmv'
])

/** 相对路径是否指向视频文件（扩展名大小写不敏感） */
export function isVideoFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return VIDEO_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/** 默认勾选的大小门槛：片子都在这之上，样片 / 花絮多小于 100 MB */
const DEFAULT_SELECT_MIN_SIZE = 100 * 1024 * 1024

/** 弹窗打开时默认勾选的文件：视频格式且大于 100 MB */
export function isDefaultSelected(file: TaskFileMeta): boolean {
  return file.size > DEFAULT_SELECT_MIN_SIZE && isVideoFile(file.path)
}

/** 模块级、非响应式：弹窗 Promise 的 resolver 与 FIFO 队列不进 reactive 状态 */
const waiting: PendingRequest[] = []
let currentResolve: ((indexes: number[] | null) => void) | null = null

export const useFilePickerStore = defineStore('miaoFilePicker', {
  state: (): {
    visible: boolean
    name: string
    files: TaskFileMeta[]
  } => ({
    visible: false,
    name: '',
    files: []
  }),
  actions: {
    /** 确认勾选：返回选中的文件序号 */
    submit(indexes: number[]) {
      finish(indexes)
    },
    /** 取消（含 X / ESC 关闭）：返回 null */
    cancel() {
      finish(null)
    }
  }
})

function finish(indexes: number[] | null): void {
  const store = useFilePickerStore()
  store.visible = false
  const resolve = currentResolve
  currentResolve = null
  resolve?.(indexes)
  showNext()
}

function showNext(): void {
  const store = useFilePickerStore()
  if (store.visible) return
  const next = waiting.shift()
  if (!next) return
  currentResolve = next.resolve
  store.name = next.name
  store.files = next.files
  store.visible = true
}

/**
 * 弹窗让用户勾选 needsSelection 的候选文件。
 * 返回勾选的文件序号（index 列表）；用户取消返回 null。
 * 多个请求按先来后到排队，同时只展示一个弹窗。
 */
export function requestFileSelection(payload: FileSelectionPayload): Promise<number[] | null> {
  return new Promise((resolve) => {
    waiting.push({ ...payload, resolve })
    showNext()
  })
}
