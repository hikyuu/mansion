import { ElNotification } from 'element-plus'
import { uploadHistory } from '@/dao/browse-history'
import { SisterStatus, useSisterStore } from '@/store/sister-store'

/**
 * 已读记账：把一条妹妹写进浏览历史。
 *
 * 「已读」的唯一真值是 `haveRead`；`status` 只描述缩略图链路走到哪一步。
 * 这两个字段分别由缩略图链路与导航写入，判断却要在记账这一处汇合 ——
 * 所以四个前置条件集中在这里，站点与缩略图链路都只喊一声「该记账了」。
 *
 * 不写归档（archive / hentai_archive）：归档只在「交付」时写，见 CONTEXT.md。
 */
export function markReadIfReady(serialNumber: string): void {
  const sister = useSisterStore()
  const info = sister.getInfo(serialNumber)
  if (!info) return

  if (info.haveRead) {
    console.log('已经记录', serialNumber)
    return
  }
  if (info.loadCompleted !== true) {
    console.log('正在加载中', serialNumber)
    return
  }
  if (info.status !== SisterStatus.ImageReady) {
    console.log('未加载成功不上传', serialNumber)
    return
  }
  const pathDate = info.pathDate
  if (pathDate === undefined || pathDate === '') {
    ElNotification({ title: '提示', message: `${serialNumber}日期格式有变动`, type: 'error' })
    return
  }

  uploadHistory(serialNumber, info)
    .then((history) => {
      console.log('上传成功', history)
      sister.updateInfo({ serialNumber, haveRead: true, status: SisterStatus.Read })
    })
    .catch((error) => console.error('上传浏览历史失败', serialNumber, error))
}
