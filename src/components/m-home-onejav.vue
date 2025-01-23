<script lang="ts" setup>
import { Onejav } from '@/site/onejav/onejav'
import { computed, defineProps, ref, toRef, toRefs, watch } from 'vue'
import { FORMAT } from '@/dictionary'
import { dailyNumberRef } from '@/dao/browse-history'
import { Calendar, DocumentCopy, Right } from '@element-plus/icons-vue'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { useActiveElement, useMagicKeys, whenever } from '@vueuse/core'
import dayjs from 'dayjs'
import type { CalendarDateType, CalendarInstance } from 'element-plus'
import { ElLoading, ElNotification } from 'element-plus'
import { logicAnd } from '@vueuse/math'

import 'dayjs/locale/zh-cn'
import { fetchRecentDaily, getDailyByPathDate, recentHistories } from '@/dao/onejav-daily-dao'

const calendar = ref<CalendarInstance>()

const props = defineProps<{ onejav: Onejav }>()

const getCurrentDate = () => {
  const date = dayjs(location.pathname, FORMAT.PATH_DATE, true)
  if (!date.isValid()) {
    return new Date()
  }
  return date.toDate()
}

const calendarDate = ref(getCurrentDate())

const onejav = toRefs<Onejav>(props.onejav)

const visible = ref<boolean>(false)

const selectDate = (val: CalendarDateType) => {
  if (!calendar.value) return
  calendar.value.selectDate(val)
}

//监听visible变化
watch(visible, (value) => {
  if (value) {
    fetchRecentDaily(10).then((histories) => {
      console.log('最近历史日期加载完成', histories.length)
    })
  }
})

function selectCurrent() {
  const date = dayjs(location.pathname, FORMAT.PATH_DATE, true)
  if (!date.isValid()) {
    ElNotification({ title: '提示', message: '当前页不是日期页', type: 'info' })
    return
  }
  calendarDate.value = date.toDate()
}
function openNextDay(self: boolean) {
  const date = dayjs(location.pathname, FORMAT.PATH_DATE, true)
  if (!date.isValid()) {
    ElNotification({ title: '提示', message: '当前页不是日期页', type: 'info' })
    return
  }
  if (date.isSame(dayjs(), 'day') || date.isAfter(dayjs(), 'day')) {
    ElNotification({ title: '提示', message: '已经是最新日期', type: 'info' })
    return
  }
  let nextDay = date.add(1, 'day').format(FORMAT.PATH_DATE)
  window.open(nextDay, self ? '_self' : '_blank')
  if (self) {
    ElLoading.service({ lock: true, fullscreen: true, text: `跳转到${nextDay}` })
  }
}
const keys = useMagicKeys()

const activeElement = useActiveElement()
const notUsingInput = computed(
  () => activeElement.value?.tagName !== 'INPUT' && activeElement.value?.tagName !== 'TEXTAREA'
)

whenever(logicAnd(keys.Ctrl_Enter, notUsingInput), () => {
  console.log('Ctrl_Enter have been pressed')
  openNextDay(false)
})

function haveReadNumber(pathDate: string) {
  return dailyNumberRef.get(pathDate) || 0
}

function dateStyle(date: Date) {
  if (!visible.value) return {}
  const pathDate = dayjs(date).format(FORMAT.PATH_DATE)
  const style = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'white'
  }

  const today = getDailyByPathDate(pathDate, onejav.siteId.value)

  if (!today) return style
  const number = haveReadNumber(pathDate)
  if (number / today.sister_number > 0.9) {
    style.backgroundColor = onejav.theme.value.SECONDARY_COLOR
    return style
  } else {
    style.backgroundColor = onejav.theme.value.WARNING_COLOR
    return style
  }
}

function readNumber(date: Date) {
  // console.log('readNumber')
  if (!visible.value) return ''
  const pathDate = dayjs(date).format(FORMAT.PATH_DATE)

  const today = getDailyByPathDate(pathDate, onejav.siteId.value)

  if (!today) return ''
  return `${haveReadNumber(pathDate)}/${today.sister_number}`
}
function solveLink(date: Date) {
  return dayjs(date).format(FORMAT.PATH_DATE)
}

const isLoadAll = computed(() => {
  return (
    props.onejav.sisters.queue.length >= props.onejav.sisters.sisterNumber * 0.9 && props.onejav.waterfall.page.isEnd
  )
})

const isDatePage = computed(() => {
  return dayjs(location.pathname, FORMAT.PATH_DATE, true).isValid()
})

const queueRef = toRef(props.onejav.sisters, 'queue')

const repeat = computed(() => {
  if (props.onejav.sisters.current_index === undefined) return 0
  const info = queueRef.value[props.onejav.sisters.current_index]
  if (!info || !info.repeatSite) return 0
  return info.repeatSite
})
</script>

<template>
  <m-img-box>
    <m-img-item v-if="isLoadAll && isDatePage">
      <el-icon style="cursor: pointer" :color="onejav.theme.value.PRIMARY_COLOR" :size="60" @click="openNextDay(false)">
        <Right />
      </el-icon>
    </m-img-item>
    <div style="display: flex; justify-content: center">
      <m-img-item v-if="repeat > 0">
        <el-icon style="" :color="onejav.theme.value.WARNING_COLOR" :size="60">
          <DocumentCopy v-if="repeat === 1" />
          <so-javdb v-if="repeat === 2" />
        </el-icon>
      </m-img-item>
      <m-img-item>
        <el-icon
          style="cursor: pointer"
          :color="onejav.theme.value.PRIMARY_COLOR"
          :size="60"
          @click="visible = !visible"
        >
          <Calendar />
        </el-icon>

        <el-drawer
          style="min-width: 700px"
          v-model="visible"
          title="日历"
          direction="rtl"
          :append-to-body="true"
          size="50%"
          :close-on-press-escape="true"
          :z-index="99999"
        >
          <template #default>
            <el-card>
              <el-date-picker v-model="calendarDate" type="date" placeholder="选择日期" size="large" />
              <el-calendar ref="calendar" v-model="calendarDate">
                <template #header="{ date }">
                  <span> <el-button size="small" @click="selectCurrent"> 当前 </el-button> </span>
                  <span>{{ date }}</span>
                  <el-button-group>
                    <el-button size="small" @click="selectDate('prev-year')">上一年</el-button>
                    <el-button size="small" @click="selectDate('prev-month')">上个月</el-button>
                    <el-button size="small" @click="selectDate('today')">今天</el-button>
                    <el-button size="small" @click="selectDate('next-month')">下个月</el-button>
                    <el-button size="small" @click="selectDate('next-year')">下一年</el-button>
                  </el-button-group>
                </template>
                <template #date-cell="{ data }">
                  <div :style="dateStyle(data.date)">
                    <el-link style="text-align: center" type="primary" :href="solveLink(data.date)" target="_self">
                      {{ data.day.split('-').slice(1).join('-') }}<br />{{ readNumber(data.date) }}</el-link
                    >
                  </div>
                </template>
              </el-calendar>
            </el-card>

            <el-card style="max-width: 200px">
              <template #header>
                <span>最近浏览历史</span>
              </template>
              <el-row>
                <el-col v-for="history in recentHistories" :key="history.path_date" :span="24">
                  <el-link type="primary" :href="history.path_date" target="_self">{{ history.path_date }}</el-link>
                </el-col>
              </el-row>
            </el-card>
          </template>
        </el-drawer>
      </m-img-item>
    </div>
  </m-img-box>
</template>
