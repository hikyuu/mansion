<script lang="ts" setup>
import { computed, ref, toRef, watch } from 'vue'
import $ from 'jquery'
import { Sisters } from '@/site/sisters'
import { SiteAbstract } from '@/site/site-abstract'
import { ElNotification } from 'element-plus'
import { onKeyStroke, useScroll } from '@vueuse/core'
import { Location, Memo } from '@element-plus/icons-vue'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'

const props = defineProps<{
  sisters: Sisters
  site: SiteAbstract
}>()

const showImage = ref(false)
const loadAll = ref({ color: 'red' })
const queueRef = toRef(props.sisters, 'queue')

const { x, y } = useScroll(window, {
  onStop: () => {
    console.log('滚动结束')
    props.site.waterfall.onScrollEvent()
  },
  behavior: 'smooth'
})

onKeyStroke('ArrowLeft', (event: KeyboardEvent) => previous(event))
onKeyStroke('ArrowRight', (event: KeyboardEvent) => nextStep(event))
onKeyStroke('Enter', (event: KeyboardEvent) => download(event))
onKeyStroke('ArrowUp', (event: KeyboardEvent) => scroll(event, true))
onKeyStroke('ArrowDown', (event: KeyboardEvent) => scroll(event))

const haveRead = computed(() => {
  if (props.sisters.current_index === undefined) return
  return queueRef.value[props.sisters.current_index].haveRead
})

const haveReadNumber = computed(() => {
  return queueRef.value.filter((sister) => sister.haveRead).length
})

const src = computed(() => {
  if (props.sisters.current_index === undefined) return
  return queueRef.value[props.sisters.current_index].src
})

function gotoLastRead(index: number) {
  props.sisters
    .getScrollTop(index)
    .then((scrollTop) => {
      console.log('坐标', scrollTop)
      y.value = scrollTop
    })
    .catch((reason) => {
      ElNotification({
        title: '提示',
        message: reason,
        type: 'info'
      })
    })
}

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
  props.sisters.previous()
  props.site.previous(x, y)
}

function download(event: KeyboardEvent) {
  event.preventDefault()
  props.site.download()
}

function nextStep(event: KeyboardEvent) {
  event.preventDefault()
  props.sisters.nextStep()
  props.site.nextStep(x, y)
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
  () => props.sisters.current_key,
  (key) => {
    // console.log('监听到key变化');
    if (key === null) return
    props.site.save(key)
  },
  {
    immediate: true
  }
)

watch(
  () => props.sisters.current_index,
  (index) => {
    const pageSisterNumber = props.sisters.sisterNumber
    if (index !== undefined && index >= pageSisterNumber - 3) {
      console.log('加载下一页')
      props.site.loadNext()
    }
  }
)

watch(
  () => props.site.waterfall.page.isEnd,
  (val) => {
    console.log('是否加载完毕', val)
    if (val) {
      loadAll.value.color = 'green'
    }
  }
)
</script>

<template>
  <div v-if="showImage" class="view-image">
    <div id="show-image" class="show-image-wrap vertical">
      <img :src="src" alt="" class="panel-img-size" />
    </div>
  </div>
  <m-img-box>
    <m-img-item style="height: 60px">
      <div class="count-group">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <Memo />
        </el-icon>
        <span :style="loadAll">{{ sisters.sisterNumber }}</span>
      </div>
      <div v-if="sisters.current_index !== undefined" class="count-group">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <Location />
        </el-icon>
        <span style="color: green">{{ sisters.current_index + 1 }}</span>
      </div>
    </m-img-item>

    <m-img-item style="height: 60px">
      <div class="count-group">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <Picture />
        </el-icon>
        <span style="color: green">{{ sisters.queue.length }}</span>
      </div>
      <div class="count-group" @click="gotoLastRead(haveReadNumber)">
        <el-icon :color="site.theme.PRIMARY_COLOR" size="30">
          <svg-readed />
        </el-icon>
        <span style="color: green">{{ haveReadNumber }}</span>
      </div>
    </m-img-item>
    <m-img-item>
      <el-icon size="60" class="icon-button" @click="viewOrClose" :color="site.theme.PRIMARY_COLOR">
        <so-fullscreen />
      </el-icon>
    </m-img-item>
    <m-img-item>
      <el-icon size="80" class="icon-button" @click="previous">
        <so-previous />
      </el-icon>
    </m-img-item>

    <m-img-item>
      <div style="display: flex; justify-content: center">
        <m-img-item>
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
      <el-icon size="80" class="icon-button" @click="previous">
        <so-next />
      </el-icon>
    </m-img-item>
  </m-img-box>
</template>

<style scoped>
.view-image {
  box-sizing: border-box;
  position: fixed;
  z-index: 999999;
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