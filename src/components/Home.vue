<template>
  <div v-if="showNavigation" class="mansion">
    <div class="img">
      <img @click="previous" class="navigation"
           src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/%E5%90%91%E4%B8%8A%E7%AE%AD%E5%A4%B4.svg"
           alt="上一部">
      <div style="display:flex; justify-content:center;">
        <img v-if="haveRead" class="download"
             src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/%E5%B7%B2%E8%AF%BB.svg" alt="已读">
        <img @click="download" class="download"
             src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/%E4%B8%8B%E8%BD%BD-1.svg" alt="下载">
      </div>
      <img @click="nextStep" class="navigation"
           src="https://raw.githubusercontent.com/hikyuu/gallery/main/assets/%E5%90%91%E4%B8%8B%E7%AE%AD%E5%A4%B4.svg"
           alt="下一部">
    </div>

  </div>
</template>

<script lang="ts">
import {Site} from "../site/site";
import {defineComponent, PropType} from "vue";
import {getSite} from "../site";

export default defineComponent({
  name: 'Home',
  props: {
    // 类型检查
    site: {
      type: Object as PropType<Site>, required: true
    },
  },
  data() {
    return {
      showNavigation: false,
      haveRead: false,
    }
  },
  created() {
    this.showNavigation = this.site.whetherToDisplay();
  },
  methods: {
    previous() {
      this.site.previous();
    },
    download() {
      this.site.download();
    },
    nextStep() {
      this.site.nextStep();
    },
  },
  watch: {
    'site.currentHaveRead': function (val, oldVal) {
      this.haveRead = val;
    },
  }
})
</script>

<style scoped>
.mansion {
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
//background: red;

}

.img {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  user-select: none;
}

.download {
  margin: 20px 15px 20px 0;
  width: 50px;
  -webkit-user-drag: none;
  user-select: none;
}

.navigation {
  width: 80px;
  -webkit-user-drag: none;
}
</style>
