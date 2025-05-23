<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import $ from 'jquery'
import { SiteAbstract } from '@/site/site-abstract'
import { ElMessage, ElNotification } from 'element-plus'
import { onKeyStroke, useActiveElement, useMagicKeys, useScroll, whenever } from '@vueuse/core'
import { Location, Memo } from '@element-plus/icons-vue'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { useConfigStore } from '@/store/config-store'
import { sites } from '@/dictionary'
import { logicAnd } from '@vueuse/math'
import { useReactStore } from '@/store/react-store'
import { useSisterStore } from '@/store/sister-store'

const sister = useSisterStore()

const props = defineProps<{
  site: SiteAbstract
}>()

const showImage = ref(false)

const loadAll = reactive({
  color: props.site.theme.WARNING_COLOR
})

const configStore = useConfigStore()

const { x, y } = useScroll(window, {
  onStop: () => {
    // console.log('滚动结束')
    props.site.waterfall.onScrollEvent()
  },
  behavior: configStore.currentConfig.smooth ? 'smooth' : 'auto'
})

onKeyStroke('ArrowLeft', (event: KeyboardEvent) => previous(event), { dedupe: true })
onKeyStroke(
  'ArrowRight',
  (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.shiftKey) return
    nextStep(event)
  },
  { dedupe: true }
)
onKeyStroke(
  'Enter',
  (event: KeyboardEvent) => {
    if (event.ctrlKey || event.shiftKey) return
    download(event)
  },
  { dedupe: true }
)
onKeyStroke(
  'ArrowUp',
  (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.shiftKey) return
    scroll(event, true)
  },
  { dedupe: true }
)
onKeyStroke(
  'ArrowDown',
  (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.shiftKey) return
    scroll(event)
  },
  { dedupe: true }
)
const keys = useMagicKeys()

const activeElement = useActiveElement()
const notUsingInput = computed(
  () => activeElement.value?.tagName !== 'INPUT' && activeElement.value?.tagName !== 'TEXTAREA'
)

whenever(logicAnd(keys.Ctrl_right, notUsingInput), () => {
  console.log('Ctrl_right have been pressed')
  sister.lastUnread(y)
})

const haveRead = computed(() => {
  const info = sister.currentSister
  if (!info) return false
  return info.haveRead
})

const src = computed(() => {
  const info = sister.currentSister
  if (info === undefined) return undefined
  return info.src
})

function viewOrClose() {
  showImage.value ? close() : view()
}

function view() {
  showImage.value = true
  $('html').css('overflow', 'hidden')
}

function close() {
  showImage.value = false
  $(`html`).css('overflow', 'auto')
}

function previous(event: KeyboardEvent) {
  event.preventDefault()
  sister.previous()
  props.site.scrollToCurrent(x, y)
}

async function download(event: KeyboardEvent) {
  event.preventDefault()
  let checkArchive = true
  if (event.altKey) {
    checkArchive = false
  }
  props.site.download(checkArchive)
}

function nextStep(event: KeyboardEvent) {
  event.preventDefault()
  sister.nextStep()
  props.site.scrollToCurrent(x, y)
}

function scroll(event: KeyboardEvent, reverse = false) {
  event.preventDefault()
  const windowHeight = $(window).height()
  if (windowHeight === undefined) {
    console.log('获取不到窗口高度')
    return false
  }
  if (reverse) {
    y.value -= windowHeight / 2
  } else {
    y.value += windowHeight / 2
  }
}

watch(
  () => sister.current_key,
  (key) => {
    // console.log('监听到key变化');
    if (!key) return
    props.site.save(key)
  },
  {
    immediate: true
  }
)

watch(
  () => sister.current_index,
  (index) => {
    if (index === undefined) return
    const sisterNumber = sister.sisterNumber
    const unreadNumber = sisterNumber - sister.haveReadNumber
    if (unreadNumber < useConfigStore().currentConfig.lazyLimit) {
      console.log('加载下一页')
      props.site.loadNext()
    }
    const info = sister.currentSister
    if (!info) return
    if (info.haveRead && info.repeatSite && info.repeatSite > 0 && info.repeatSite !== info.site) {
      ElMessage({
        message: `${info.serialNumber}在${sites[info.repeatSite]}看过`,
        type: 'warning',
        offset: window.innerHeight / 2
      })
    }
  }
)

watch(
  () => props.site.waterfall.page.isEnd,
  (isEnd) => {
    loadAll.color = isEnd ? 'green' : props.site.theme.WARNING_COLOR
  },
  { immediate: true }
)

function lastUnRead() {
  sister.lastUnread(y)
}
function location() {
  const index = sister.current_index
  if (index === undefined) {
    return 0
  }
  return index + 1
}
</script>

<template>
  <div v-if="showImage" class="view-image">
    <div id="show-image" class="show-image-wrap vertical">
      <img v-for="(item, index) in src" :src="item" :key="index" alt="" class="panel-img-size" />
    </div>
  </div>
  <m-img-box>
    <m-img-item v-if="useReactStore().wgt1670" style="height: 60px">
      <div class="count-group">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <Memo />
        </el-icon>
        <span :style="loadAll">{{ sister.sisterNumber }}</span>
      </div>
      <div class="count-group">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <Location />
        </el-icon>
        <span style="color: green">{{ location() }}</span>
      </div>
    </m-img-item>
    <m-img-item v-if="useReactStore().wgt1670" style="height: 60px">
      <div class="count-group">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <Picture />
        </el-icon>
        <span style="color: green">{{ sister.size }}</span>
      </div>
      <div class="count-group" @click="lastUnRead">
        <el-icon style="cursor: pointer" :color="site.theme.PRIMARY_COLOR" size="30">
          <svg-readed />
        </el-icon>
        <span style="color: green">{{ sister.haveReadNumber }}</span>
      </div>
    </m-img-item>

    <m-img-item v-if="false">
      <el-icon size="60" class="icon-button" @click="viewOrClose" :color="site.theme.PRIMARY_COLOR">
        <so-fullscreen />
      </el-icon>
    </m-img-item>
    <m-img-item>
      <el-icon size="60" class="icon-button" @click="previous">
        <so-previous />
      </el-icon>
    </m-img-item>
    <m-img-item>
      <div style="display: flex; justify-content: center">
        <m-img-item v-if="false">
          <el-icon v-if="haveRead" :color="site.theme.PRIMARY_COLOR" size="50">
            <svg-readed />
          </el-icon>
        </m-img-item>
        <m-img-item>
          <el-icon size="60" :color="site.theme.PRIMARY_COLOR" class="download" @click="download">
            <fa-solid-file-download />
          </el-icon>
        </m-img-item>
      </div>
    </m-img-item>
    <m-img-item>
      <el-icon size="60" class="icon-button" @click="nextStep">
        <so-next />
      </el-icon>
    </m-img-item>
  </m-img-box>
</template>

<style scoped>
.view-image {
  box-sizing: border-box;
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(24, 25, 28, 0.85);
  transform: scale(1);
  user-select: none;
}

.download {
  cursor: pointer;
}

.icon-button {
  -webkit-user-drag: none;
  cursor: pointer;
}

.show-image-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  width: 100%;
  height: 100%;
  max-height: 100%;
  padding: 0 100px;
  overflow: auto;
}

.vertical {
  flex-direction: column;
  justify-content: start;
}

.count-group {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
}
</style>
