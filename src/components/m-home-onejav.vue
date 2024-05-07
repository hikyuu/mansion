<script lang="ts" setup>
import { Onejav } from '@/site/onejav/onejav'
import type { OnejavDaily } from '@/site/onejav/onejav-daily'
import { dailiesRef } from '@/site/onejav/onejav-daily'
import { defineProps, ref, toRefs } from 'vue'
import { FORMAT } from '@/dictionary'
import { getTodayHistories } from '@/site/onejav/onejav-history'
import { Calendar } from '@element-plus/icons-vue'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { onKeyStroke } from '@vueuse/core'
import dayjs from 'dayjs'
import { ElLoading, ElNotification } from 'element-plus'

const props = defineProps<{ onejav: Onejav }>()

const selected = ref(new Date())

const onejav = toRefs<Onejav>(props.onejav)

const visible = ref<boolean>(false)

function gotoNextDay(event: KeyboardEvent) {
  console.log('gotoNextDay')
  event.preventDefault()
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
  window.open(nextDay, '_self')
  ElLoading.service({ lock: true, fullscreen: true, text: `跳转到${nextDay}` })
}

onKeyStroke('0', (event: KeyboardEvent) => gotoNextDay(event), { dedupe: true })

function haveReadNumber(pathDate: string) {
  // console.time('history-filter')
  const length = getTodayHistories(pathDate).length
  // console.timeEnd('history-filter')
  return length
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
  const today = dailiesRef.value.find((daily: OnejavDaily) => daily.pathDate === pathDate)
  if (!today) return style
  const number = haveReadNumber(pathDate)
  if (number / today.sisterNumber > 0.9) {
    style.backgroundColor = onejav.theme.value.SECONDARY_COLOR
    return style
  } else {
    style.backgroundColor = onejav.theme.value.WARNING_COLOR
    return style
  }
}

function readNumber(date: Date) {
  if (!visible.value) return ''
  const pathDate = dayjs(date).format(FORMAT.PATH_DATE)
  const today = dailiesRef.value.find((daily: OnejavDaily) => daily.pathDate === pathDate)
  if (!today) return ''
  return `${haveReadNumber(pathDate)}/${today.sisterNumber}`
}

function gotoDate(date: Date) {
  let pathDate = dayjs(date).format(FORMAT.PATH_DATE)
  window.open(`${pathDate}`, '_self')
  ElLoading.service({ lock: true, fullscreen: true, text: `跳转到${pathDate}` })
}
</script>

<template>
  <m-img-box>
    <m-img-item>
      <el-popover
        v-model:visible="visible"
        :width="900"
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
          <el-calendar>
            <template #date-cell="{ data }">
              <p :style="dateStyle(data.date)" @click="gotoDate(data.date)">
                <a>{{ data.day.split('-').slice(1).join('-') }}</a>
                <a>{{ readNumber(data.date) }}</a>
              </p>
            </template>
          </el-calendar>
        </template>
      </el-popover>
    </m-img-item>
  </m-img-box>
</template>
