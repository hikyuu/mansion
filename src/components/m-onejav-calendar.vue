<script setup lang="ts">
import { fetchRecentDaily, getDailyByPathDate, recentHistories } from '@/dao/onejav-daily-dao'
import MImgItem from '@/components/m-img-item.vue'
import { Calendar } from '@element-plus/icons-vue'
import { defineProps, ref, toRefs, watch } from 'vue'
import { Onejav } from '@/site/onejav/onejav'
import dayjs from 'dayjs'
import { FORMAT } from '@/dictionary'
import { type CalendarDateType, type CalendarInstance, ElNotification } from 'element-plus'
import { dailyNumberRef } from '@/dao/browse-history'

const props = defineProps({
  onejav: {
    type: Object as () => Onejav,
    required: true
  },
  size: {
    type: Number,
    default: 60
  }
})
const calendar = ref<CalendarInstance>()

const visible = ref<boolean>(false)
//监听visible变化
watch(visible, (value) => {
  if (value) {
    fetchRecentDaily(10).then((histories) => {
      console.log('最近历史日期加载完成', histories.length)
    })
  }
})

const onejav = toRefs<Onejav>(props.onejav)
const getCurrentDate = () => {
  const date = dayjs(location.pathname, FORMAT.PATH_DATE, true)
  if (!date.isValid()) {
    return new Date()
  }
  return date.toDate()
}
const calendarDate = ref(getCurrentDate())
const selectDate = (val: CalendarDateType) => {
  if (!calendar.value) return
  calendar.value.selectDate(val)
}

function selectCurrent() {
  const date = dayjs(location.pathname, FORMAT.PATH_DATE, true)
  if (!date.isValid()) {
    ElNotification({ title: '提示', message: '当前页不是日期页', type: 'info' })
    return
  }
  calendarDate.value = date.toDate()
}
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
</script>

<template>
  <m-img-item>
    <el-icon
      style="cursor: pointer"
      :color="onejav.theme.value.PRIMARY_COLOR"
      :size="props.size"
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
</template>

<style scoped></style>
