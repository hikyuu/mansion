<template>
  <div v-if="showImage" class="view-image">
    <div id="show-image" class="show-image-wrap vertical">
      <img class="panel-img-size" :src="src" alt="">
    </div>
  </div>

  <div class="panel-img">
    <div class="panel-img-box" style="height: 60px">
      <div class="count-group">
        <img class="menu-count-img" :src="picx('/all.svg')" alt="全部">
        <span :style="loadAll">{{ sisters.sisterNumber }}</span>
      </div>
      <div v-if="sisters.current_index!==undefined" class="count-group">
        <el-icon size="30" :color="site.theme.primary_color">
          <Location/>
        </el-icon>
        <span style="color: green">{{ sisters.current_index + 1 }}</span>
      </div>

    </div>
    <div class="panel-img-box " style="height: 60px">
      <div class="count-group">
        <el-icon size="30" :color="site.theme.primary_color">
          <Picture/>
        </el-icon>
        <span style="color:green">{{ sisters.queue.length }}</span>
      </div>
      <div class="count-group" @click="gotoLastRead(haveReadNumber)">
        <img class="menu-count-img" v-bind="ICON.HAVE_READ">
        <span style="color:green">{{ haveReadNumber }}</span>
      </div>
    </div>

    <div class="panel-img-box">
      <img @click="viewOrClose" class="icon-button fullscreen" :src="picx('/fullscreen_1.svg')" alt="图片浏览">
    </div>

    <div class="panel-img-box">
      <img @click="previous" class="icon-button" :src="picx('/last.svg')" alt="上一部">
    </div>

    <div class="panel-img-box">
      <div style="display:flex; justify-content:center;">
        <img v-if="haveRead" class="download" v-bind="ICON.HAVE_READ">
        <div class="panel-img-box">
          <img @click="download" class="download" :src="picx('/download.svg')" alt="下载">
        </div>
      </div>
    </div>

    <div class="panel-img-box">
      <img @click="nextStep" class="icon-button" :src="picx('/next.svg')" alt="下一部">
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, ref, toRef, watch} from "vue";
import $ from "jquery";
import {Sisters} from "../site/sisters";
import {SiteAbstract} from "../site/site-abstract";
import {ICON, picx} from "../dictionary";
import {ElNotification} from "element-plus";
import {onKeyStroke, useScroll} from "@vueuse/core/index";

const props = defineProps<{
  sisters: Sisters,
  site: SiteAbstract
}>()

const showImage = ref(false);
const loadAll = ref({color: 'red'});
const queueRef = toRef(props.sisters, 'queue');

const {x, y} = useScroll(window, {
  behavior: 'smooth',
  onStop: () => {
    console.log('滚动结束')
    props.site.waterfall.scroll();
  },
})

onKeyStroke('ArrowLeft', () => previous())
onKeyStroke('ArrowRight', () => nextStep())
onKeyStroke('Enter', () => download())
onKeyStroke('ArrowUp', (event) => scroll(event, true))
onKeyStroke('ArrowDown', (event) => scroll(event))

const haveRead = computed(() => {
  if (props.sisters.current_index === undefined) return
  return queueRef.value[props.sisters.current_index].haveRead;
})

const haveReadNumber = computed(() => {
  return queueRef.value.filter((sister) => sister.haveRead).length;
})

const src = computed(() => {
  if (props.sisters.current_index === undefined) return
  return queueRef.value[props.sisters.current_index].src;
})

function gotoLastRead(index: number) {
  props.sisters.getScrollTop(index).then((scrollTop) => {
    console.log('坐标', scrollTop);
    y.value = scrollTop;
  }).catch((reason) => {
    ElNotification({
      title: '提示',
      message: reason,
      type: 'info',
    })
  })
}

function viewOrClose() {
  showImage ? close() : view();
}

function view() {
  showImage.value = true;
  $('html').css('overflow', 'hidden');
}

function close() {
  showImage.value = false;
  $(`html`).css('overflow', 'auto');
}

function previous() {
  props.sisters.previous();
  props.site.previous(x, y);
}

function download() {
  props.site.download();
}

function nextStep() {
  props.sisters.nextStep();
  props.site.nextStep(x, y);
}

function scroll(event: KeyboardEvent, reverse = false) {
  event.preventDefault();
  const windowHeight = $(window).height()
  if (windowHeight === undefined) {
    console.log('获取不到窗口高度')
    return false
  }
  if (reverse) {
    y.value -= windowHeight / 2;
  } else {
    y.value += windowHeight / 2;
  }
}

watch(
    () => props.sisters.current_key,
    (key, oldVal) => {
      // console.log('监听到key变化');
      if (key === null) return
      props.site.save(key);
    }, {
      immediate: true
    }
)

watch(
    () => props.sisters.current_index,
    (index, oldVal) => {
      const pageSisterNumber = props.sisters.sisterNumber;
      if (index !== undefined && index >= pageSisterNumber - 3) {
        console.log('加载下一页')
        props.site.loadNext();
      }
    },
)

watch(
    () => props.site.waterfall.page.isEnd,
    (val, oldVal) => {
      console.log('是否加载完毕', val)
      if (val) {
        loadAll.value.color = 'green'
      }
    }
)

</script>

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
  width: 50px;
}

.icon-button {
  width: 80px;
  -webkit-user-drag: none;
  cursor: pointer;
}

.fullscreen {
  width: 60px;
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


.menu-count-img {
  width: 30px;
  height: 30px;
}

.count-group {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
}
</style>
