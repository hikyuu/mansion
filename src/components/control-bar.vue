<template>
  <div v-if="showImage" class="view-image">
    <div id="show-image" class="show-image-wrap vertical">
      <img class="img_size" :src="src" alt="">
    </div>
  </div>
  <div class="mansion">
    <div class="img">
      <div class="img-box" style="height: 60px">
        <div v-if="sisters.current_index!==undefined" class="count-group">
          <svg t="1696417646832" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg"
               p-id="11551" width="200" height="200">
            <path
                d="M511.999488 65.290005c-152.771429 0-276.532127 124.982526-276.532127 279.193747 0 154.210197 276.532127 614.225219 276.532127 614.225219s276.532127-460.015022 276.532127-614.225219C788.531616 190.251042 664.726915 65.290005 511.999488 65.290005L511.999488 65.290005zM511.999488 512c-91.609441 0-165.901471-75.033927-165.901471-167.516248 0-92.482321 74.29203-167.516248 165.901471-167.516248 91.610464 0 165.945473 75.033927 165.945473 167.516248C677.944961 436.966073 603.609952 512 511.999488 512L511.999488 512zM511.999488 512"
                fill="green" p-id="11552"></path>
          </svg>
          <span style="color: green">{{ sisters.current_index + 1 }}</span>
        </div>

      </div>
      <div class="img-box " style="height: 60px">
        <div class="count-group">
          <img class="menu-count-img" :src="picx('/all.svg')" alt="全部">
          <span :style="loadAll">{{ sisters.sisterNumber }}</span>
        </div>

        <div class="count-group">
          <img class="menu-count-img" v-bind="ICON.HAVE_READ">
          <span style="color:green">{{ site.haveReadNumber() }}</span>
        </div>
      </div>

      <div class="img-box">
        <img @click="viewOrClose" class="icon-button fullscreen" :src="picx('/fullscreen_1.svg')" alt="图片浏览">
      </div>

      <div class="img-box">
        <img @click="previous" class="icon-button" :src="picx('/last.svg')" alt="上一部">
      </div>

      <div class="img-box">
        <div style="display:flex; justify-content:center;">
          <img v-if="site.haveRead()" class="download" v-bind="ICON.HAVE_READ">
          <div class="img-box">
            <img @click="download" class="download" :src="picx('/download.svg')" alt="下载">
          </div>
        </div>
      </div>

      <div class="img-box">
        <img @click="nextStep" class="icon-button" :src="picx('/next.svg')" alt="下一部">
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, onMounted, PropType, Ref, ref, watch} from "vue";
import $ from "jquery";
import {Sisters} from "../site/sisters";
import {SiteAbstract} from "../site/site-abstract";
import {ICON, picx} from "../dictionary";

const props = defineProps({
  site: {
    type: Object as PropType<SiteAbstract>, required: true
  },
  sisters: {
    type: Object as PropType<Sisters>, required: true
  }
})

const showImage = ref(false);
const scrolling = ref(false);
const loadAll = ref({color: 'red'});

onMounted(() => {
  $(document).on('keydown', event => {
    // console.log(event.key);
    switch (event.key) {
      case 'ArrowLeft':
        previous();
        break;
      case 'ArrowRight':
        nextStep();
        break;
      case 'Enter':
        download();
        break;
      case 'ArrowUp':
        scroll(true);
        break;
      case 'ArrowDown':
        scroll();
        break;
    }
  })
})

const src = computed(() => {
  if (props.sisters.current_index === undefined) return
  return props.sisters.queue[props.sisters.current_index]!.src;
})

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
  props.site.previous();
}

function download() {
  props.site.download();
}

function nextStep() {
  props.sisters.nextStep();
  props.site.nextStep();
}

function scroll(reverse = false) {
  const windowHeight = $(window).height()
  if (windowHeight === undefined) {
    console.log('获取不到窗口高度')
    return false
  }
  const scrollTop = $(window).scrollTop();
  if (scrollTop === undefined) {
    console.log('获取不到滚动高度')
    return false
  }
  let offset
  if (reverse) {
    offset = scrollTop - windowHeight / 2;
  } else {
    offset = scrollTop + windowHeight / 2;
  }

  $('html,body').animate({scrollTop: offset}, 150);
}

watch(
    () => props.sisters.current_key,
    (key, oldVal) => {
      // console.log('监听到key变化');
      if (key === null) return
      props.site.save(key);
    },
    {immediate: true}
)

watch(
    () => props.sisters.current_index,
    (index, oldVal) => {
      const pageSisterNumber = props.sisters.sisterNumber;
      console.log('当前番号', index, '页面妹妹数量', pageSisterNumber)
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

watch(
    () => props.site.waterfall.recordTop,
    (val, oldVal) => {
      setTimeout(() => {
        if (val === window.scrollY) { //延时执行后当newValue等于window.scrollY，代表滚动结束
          console.log('滚动结束');
          props.site.waterfall.recordTop = val; //每次滚动结束后都要给oldScrollTop赋值
          scrolling.value = false;
          props.site.waterfall.scroll();
        }
      }, 200); //必须使用延时器，否则每次newValue和window.scrollY都相等，无法判断，20ms刚好大于watch的侦听周期，故延时20ms
      if (props.site.waterfall.recordTop === oldVal) { //每次滚动开始时oldScrollTop与oldValue相等
        console.log('滚动开始');
        scrolling.value = true;
      }
    }
);
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

.close-container {
  top: 16px;
  right: 16px;
}

.view-icon-button {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  z-index: 2;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  color: white;
  background: rgba(0, 0, 0, 0.58);
  transition: 0.2s;
  cursor: pointer;
}

.mansion {
  box-sizing: border-box;
  z-index: 9999999;
  position: fixed;
  top: 50%;
  right: 20px;
  transform: translateY(-50%);
}

.img {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  -webkit-user-drag: none;
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

.last-container {
  top: 50%;
  left: 16px;
  transform: translateY(-50%);
}

.next-container {
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
}

.svg-icon {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 18px;
  height: 18px;
}

.svg-size {
  width: 18px;
  height: 18px;
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

.img_size {
  width: 1400px;
  max-width: 1400px;
}

.img-box {
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 80px;
  height: 80px;
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
