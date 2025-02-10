<script setup lang="ts">
import { Location, Memo } from '@element-plus/icons-vue'
import MImgItem from '@/components/m-img-item.vue'
import { computed, defineProps } from 'vue'
import type { SiteAbstract } from '@/site/site-abstract'
import { useScroll } from '@vueuse/core'
import { useConfigStore } from '@/store/config-store'
import { useSisterStore } from '@/store/sister-store'

const sister = useSisterStore()

const props = defineProps({
  site: {
    type: Object as () => SiteAbstract,
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

const loadAll = computed(() => {
  if (props.site.waterfall.page.isEnd) {
    return {
      color: 'green'
    }
  } else {
    return {
      color: props.site.theme.WARNING_COLOR
    }
  }
})

const { x, y } = useScroll(window, {
  onStop: () => {
    props.site.waterfall.onScrollEvent()
  },
  behavior: useConfigStore().currentConfig.smooth ? 'smooth' : 'auto'
})

function lastUnRead() {
  sister.lastUnread(y)
}

function location() {
  const currentIndex = sister.current_index
  if (currentIndex === undefined) {
    return 0
  }
  return currentIndex + 1
}
</script>

<template>
  <m-img-item style="flex-direction: column">
    <el-row>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }">
        <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <Memo />
        </el-icon>
        <div style="min-width: 30px">
          <span :style="loadAll">{{ sister.sisterNumber }}</span>
        </div>
      </div>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }">
        <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <Location />
        </el-icon>
        <div style="min-width: 30px">
          <span style="color: green">{{ location() }}</span>
        </div>
      </div>
    </el-row>
    <el-row>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }">
        <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <Picture />
        </el-icon>
        <div style="min-width: 30px">
          <span style="color: green">{{ sister.queue.length }}</span>
        </div>
      </div>
      <div class="count-group" :class="{ 'flex-direction-column': props.column }" @click="lastUnRead">
        <el-icon style="cursor: pointer" :color="site.theme.PRIMARY_COLOR" :size="props.size">
          <svg-readed />
        </el-icon>
        <div style="min-width: 30px">
          <span style="color: green">{{ sister.haveReadNumber }}</span>
        </div>
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
