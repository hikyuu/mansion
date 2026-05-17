import dayjs, { type Dayjs } from 'dayjs'
import { FORMAT } from '@/dictionary'
import { ElNotification } from 'element-plus'

export class ExhentaiUtils {
  /**
   * 解析日期文本为 Dayjs 对象，使用字典中定义的格式
   */
  static parseDateText(dateText: string): Dayjs | null {
    if (!dateText) return null

    // 尝试使用字典中定义的格式解析
    const formats = [FORMAT.DATE_TEXT, FORMAT.DATE_SIMPLE]

    for (const format of formats) {
      const d = dayjs(dateText, format)
      if (d.isValid()) return d
    }

    // 尝试直接解析（ISO 格式等）
    const d = dayjs(dateText)
    if (d.isValid()) return d

    return null
  }

  /**
   * 应用存档样式到下载按钮
   */
  static applyArchiveStyle($download: JQuery): void {
    // 更偏红的滤镜：增加饱和并稍微向红色偏移（使用负 hue-rotate），并将透明度设为 50%
    const filterCss = 'sepia(1) saturate(8) hue-rotate(-10deg) brightness(1.05) contrast(1)'
    const opacityVal = '0.5'
    try {
      const $img = $download.find('img').first()
      if ($img.length) {
        $img.css({ filter: filterCss, opacity: opacityVal })
      } else {
        $download.css({ filter: filterCss, opacity: opacityVal })
      }
      $download.addClass('archived-no-newer-seed')
    } catch {
      // 忽略 DOM 操作错误
    }
  }

  /**
   * 显示通知消息
   */
  static showNotification(message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info'): void {
    ElNotification({ title: '提示', message, type })
  }
}
