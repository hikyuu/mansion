<script lang="ts" setup>
import { Onejav } from '@/site/onejav/onejav'
import type { OnejavDaily } from '@/site/onejav/onejav-daily'
import { dailiesRef } from '@/site/onejav/onejav-daily'
import { computed, defineProps, ref, toRefs } from 'vue'
import moment from 'moment'
import { FORMAT } from '@/dictionary'
import { getTodayHistories } from '@/site/onejav/onejav-history'
import { Calendar } from '@element-plus/icons-vue'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'

const props = defineProps<{ onejav: Onejav }>()

const onejav = toRefs<Onejav>(props.onejav)

const visible = ref<boolean>()

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
  return moment(latest_dailies.value[0]?.onejavDaily.pathDate, FORMAT.PATH_DATE)
    .add(1, 'days')
    .format(FORMAT.PATH_DATE)
})

function haveReadNumber(pathDate: string) {
  console.time('history-filter')
  const length = getTodayHistories(pathDate).length
  console.timeEnd('history-filter')
  return length
}

declare interface LatestDaily {
  onejavDaily: OnejavDaily
  haveReadNumber: number
}
</script>

<template>
  <m-img-box>
    <m-img-item>
      <el-popover
        v-model:visible="visible"
        :width="300"
        placement="left"
        popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
        trigger="hover"
      >
        <template #reference>
          <m-img-item>
            <el-icon :color="onejav.theme.value.PRIMARY_COLOR" :size="60">
              <Calendar />
            </el-icon>
          </m-img-item>
        </template>
        <template #default>
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
      </el-popover>
    </m-img-item>
  </m-img-box>
</template>
