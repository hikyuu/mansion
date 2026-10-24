import { defineStore } from 'pinia'
import type { DailyHistoryDto } from '@/dao/browse-history'

/**
 * 每日统计的本地缓存：路径日期 → 当天记录过多少条妹妹。
 *
 * 这曾经是 `dao/browse-history` 里的一个模块级 reactive Map —— DAO 顺手兼了 UI 缓存，
 * 于是「查库」和「更新界面看到的数字」两件事绑在一起，谁灌、谁清都看不出来。
 * 现在：DAO 只返回行，缓存由调用方显式 fill。
 */
export const useDailyHistoryStore = defineStore('dailyHistory', {
  state: (): { counts: Map<string, number> } => ({
    counts: new Map<string, number>()
  }),

  getters: {
    /** 某个路径日期已记录的妹妹数 */
    countOf: (state) => {
      return (pathDate: string): number => state.counts.get(pathDate) ?? 0
    }
  },

  actions: {
    /**
     * 灌入一批 daily_history 行。
     * 两个入口（按日期查、按月查）可能先后盖到同一天，晚到的旧结果不得把数字改小，故取较大值。
     */
    fill(rows: DailyHistoryDto[]): void {
      for (const row of rows) {
        const known = this.counts.get(row.path_date) ?? 0
        this.counts.set(row.path_date, Math.max(known, row.history_number))
      }
    },

    clear(): void {
      this.counts.clear()
    }
  }
})
