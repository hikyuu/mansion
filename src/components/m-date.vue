<template>
  <div style="display: flex; gap: 16px; flex-direction: column">
    <el-text>最新已读</el-text>
    <template v-for="daily in latest_dailies" v-bind:key="daily.onejavDaily.pathDate">
      <el-link
        :href="daily.onejavDaily.pathDate"
        :type="daily.haveReadNumber >= daily.onejavDaily.sisterNumber ? 'success' : 'warning'"
        target="_blank"
      >
        {{ daily.onejavDaily.pathDate }}
        妹妹:{{ daily.onejavDaily.sisterNumber }} 已读:{{ daily.haveReadNumber }}
      </el-link>
    </template>
    <template v-if="latest_dailies.length > 0">
      <el-text>下一天</el-text>
      <el-link :href="next_dailies" target="_blank" type="danger">
        {{ next_dailies }}
      </el-link>
    </template>
  </div>
</template>
<script lang="ts" setup>
import { computed, ref } from 'vue'
import { dailiesRef, type OnejavDaily } from '@/site/onejav/onejav-daily'
import { FORMAT } from '@/dictionary/index'
import { getTodayHistories } from '@/site/onejav/onejav-history'
import dayjs from 'dayjs'

const visible = ref<boolean>(false)

const latest_dailies = computed<LatestDaily[]>(() => {
  if (!visible.value) {
    return []
  }
  const latestDailies = dailiesRef.value
    .sort((a: OnejavDaily, b: OnejavDaily) => {
      return b.releaseDateStamp - a.releaseDateStamp
    })
    .filter((daily: OnejavDaily) => daily.loadCompleted)
    .slice(0, Math.min(3, dailiesRef.value.length))
  return latestDailies.map((daily: OnejavDaily) => {
    return {
      onejavDaily: daily,
      haveReadNumber: haveReadNumber(daily.pathDate)
    } as LatestDaily
  })
})

const next_dailies = computed<string>(() => {
  return dayjs(latest_dailies.value[0]?.onejavDaily.pathDate, FORMAT.PATH_DATE).add(1, 'days').format(FORMAT.PATH_DATE)
})

function haveReadNumber(pathDate: string) {
  // console.time('history-filter')
  const length = getTodayHistories(pathDate).length
  // console.timeEnd('history-filter')
  return length
}

export declare interface LatestDaily {
  onejavDaily: OnejavDaily
  haveReadNumber: number
}
</script>
