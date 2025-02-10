<script lang="ts" setup>
import { Onejav } from '@/site/onejav/onejav'
import { computed, defineProps, toRefs } from 'vue'
import { FORMAT } from '@/dictionary'
import { DocumentCopy, Right } from '@element-plus/icons-vue'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { useActiveElement, useMagicKeys, whenever } from '@vueuse/core'
import dayjs from 'dayjs'
import { ElLoading, ElNotification } from 'element-plus'
import { logicAnd } from '@vueuse/math'
import 'dayjs/locale/zh-cn'
import MOnejavCalendar from '@/components/m-onejav-calendar.vue'
import { useReactStore } from '@/store/react-store'
import { useSisterStore } from '@/store/sister-store'

const sister = useSisterStore()

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

const onejav = toRefs<Onejav>(props.onejav)

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

const isLoadAll = computed(() => {
  return sister.queue.length >= sister.sisterNumber * 0.9 && props.onejav.waterfall.page.isEnd
})

const isDatePage = computed(() => {
  return dayjs(location.pathname, FORMAT.PATH_DATE, true).isValid()
})

const repeat = computed(() => {
  const currentIndex = sister.current_index
  if (currentIndex === undefined) return 0
  const info = sister.queue[currentIndex]
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
      <m-onejav-calendar v-if="useReactStore().wgt1670" :onejav="props.onejav" :size="size" />
    </div>
  </m-img-box>
</template>
