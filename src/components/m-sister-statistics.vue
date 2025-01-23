<script setup lang="ts">
import { Location, Memo } from '@element-plus/icons-vue'
import MImgItem from '@/components/m-img-item.vue'
import { computed, defineProps, reactive, toRef } from 'vue'
import type { Sister } from '@/site/sister'
import type { SiteAbstract } from '@/site/site-abstract'
import { useScroll } from '@vueuse/core'
import { useConfigStore } from '@/store/config-store'

const props = defineProps({
  site: {
    type: Object as () => SiteAbstract,
    required: true
  },
  sister: {
    type: Object as () => Sister,
    required: true
  },
  size: {
    type: Number,
    default: 30
  },
  column: {
    type: Boolean,
    default: false
  }
})
const loadAll = reactive({
  color: props.site.theme.WARNING_COLOR
})
const queueRef = toRef(props.sister, 'queue')

const haveReadNumber = computed(() => {
  return queueRef.value.filter((sister) => sister.haveRead).length
})

const { x, y } = useScroll(window, {
  onStop: () => {
    props.site.waterfall.onScrollEvent()
  },
  behavior: useConfigStore().currentConfig.smooth ? 'smooth' : 'auto'
})
</script>

<template>
  <m-img-item style="flex-direction: column">
    <el-row>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }">
        <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <Memo />
        </el-icon>
        <span :style="loadAll">{{ sister.sisterNumber }}</span>
      </div>
      <div
        v-if="sister.current_index !== undefined"
        class="count-group"
        :class="{ 'flex-direction-column': props.column }"
      >
        <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <Location />
        </el-icon>
        <span style="color: green">{{ sister.current_index + 1 }}</span>
      </div>
    </el-row>
    <el-row>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }">
        <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <Picture />
        </el-icon>
        <span style="color: green">{{ sister.queue.length }}</span>
      </div>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }" @click="props.sister?.lastUnread(y)">
        <el-icon style="cursor: pointer" :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <svg-readed />
        </el-icon>
        <span style="color: green">{{ haveReadNumber }}</span>
      </div>
    </el-row>
  </m-img-item>
</template>

<style scoped>
.count-group {
  display: flex;
  justify-content: center;
  align-items: center;
}
.flex-direction-column {
  flex-direction: column;
}
</style>
