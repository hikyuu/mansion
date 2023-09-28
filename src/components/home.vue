<template>


  <div v-if="showImage" class="view-image">
    <!--<div>-->
    <!--  <div @click="close" class="view-icon-button close-container">-->
    <!--    <i class="svg-icon">-->
    <!--      <img class="svg-size" src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/close_w.svg">-->
    <!--    </i>-->
    <!--  </div>-->
    <!--  <div v-if="!isStart" @click="previous" class="view-icon-button last-container">-->
    <!--    <i class="svg-icon">-->
    <!--      <img class="svg-size" src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/left_w.svg">-->
    <!--    </i>-->
    <!--  </div>-->
    <!--  <div v-if="!isEnd" @click="nextStep" class="view-icon-button next-container">-->
    <!--    <i class="svg-icon">-->
    <!--      <img class="svg-size" src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/right_w.svg">-->
    <!--    </i>-->
    <!--  </div>-->
    <!--</div>-->
    <div id="show-image" class="show-image-wrap vertical">
      <img class="img_size" :src="src" alt="">
    </div>

  </div>
  <div v-if="showNavigation" class="mansion">
    <div class="img">

      <img @click="viewOrClose" class="icon-button fullscreen"
           :src="picx('/fullscreen_1.svg')"
           alt="图片浏览">

      <img @click="previous" class="icon-button"
           :src="picx('/last.svg')"
           alt="上一部">

      <div style="display:flex; justify-content:center;">
        <img v-if="haveRead" class="download"
             src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/readed.svg" alt="已读">
        <img @click="download" class="download"
             :src="picx('/download.svg')" alt="下载">

      </div>
      <img @click="nextStep" class="icon-button"
           :src="picx('/next.svg')"
           alt="下一部">
    </div>

  </div>
</template>

<script lang="ts">
import {defineComponent, PropType} from "vue";
import $ from "jquery";
import {picx} from "../dictionary";
import {Sisters} from "../site/sisters";
import {SiteInterface} from "../site/site-interface";

export default defineComponent({
  name: 'Home',
  props: {
    // 类型检查
    site: {
      type: Object as PropType<SiteInterface>, required: true
    },
    sisters: {
      type: Object as PropType<Sisters>, required: true
    }
  },
  data() {
    return {
      showImage: false,
      showNavigation: false
    }
  },
  created() {
    this.showNavigation = this.site.whetherToDisplay();
    $(document).on('keydown', event => {
      console.log(event.key);

      switch (event.key) {
        case 'ArrowLeft':
          this.previous();
          break;
        case 'ArrowRight':
          this.nextStep();
          break;
        case 'Enter':
          this.download();
          break;
        case 'ArrowUp':
          this.scroll(true);
          break;
        case 'ArrowDown':
          this.scroll();
          break;
      }
    })
  },

  computed: {
    src() {
      if (this.sisters.current_index === undefined) return
      return this.sisters.queue[this.sisters.current_index]!.src;
    },

    isEnd() {
      if (this.sisters.current_index === undefined) return true;
      return this.sisters.current_index + 1 >= this.sisters.queue.length;
    },
    isStart() {
      return !this.sisters.current_index || this.sisters.current_index <= 0;
    },
    haveRead() {
      return this.site.haveRead();
    },
  },
  methods: {
    picx,
    viewOrClose() {
      this.showImage ? this.close() : this.view();
    },

    view() {
      this.showImage = true;
      $('html').css('overflow', 'hidden');
    },

    close() {
      this.showImage = false;
      $(`html`).css('overflow', 'auto');
    },

    previous() {
      this.sisters.previous();
      this.site.previous();
    },
    download() {
      this.site.download();
    },
    nextStep() {
      this.sisters.nextStep();
      this.site.nextStep();
    },
    scroll(reverse = false) {
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
    },
  },
  watch: {
    'site.currentHaveRead': function (val, oldVal) {
      this.haveRead = val;
    },
    'sisters.current_key': {
      handler(key, oldVal) {
        this.site.save(key);
      }
    },
    'sisters.current_index': {
      handler(index, oldVal) {
        if (index !== undefined && index >= this.sisters.queue.length - 3) {
          this.site.loadNext();
        }
      }
    }
  }
})
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
  margin: 20px 15px 20px 0;
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
  margin: 20px 10px;
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
</style>
