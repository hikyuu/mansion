<script lang="ts" setup>

import {getSite} from "../site";
import {onMounted, ref} from "vue";
import {Sisters} from "../site/sisters";
import {SiteAbstract} from "../site/site-abstract";
import {Onejav} from "../site/onejav/onejav";
import ControlPanel from "./control-panel.vue";
import HomeOnejav from "./home-onejav.vue";
import MansionSetting from "./mansion-setting.vue";

const site = ref<SiteAbstract>();

const sisters = ref<Sisters>(new Sisters());

onMounted(() => {
  const exactSite = getSite(sisters.value);
  if (exactSite === undefined) {
    console.log(`不支持当前网站!`)
    return
  }
  site.value = exactSite;

  site.value.mount();
});

</script>

<template>
  <template v-if="site">
    <div class="mansion">
      <home-onejav v-if="site instanceof Onejav" :onejav="site"/>
      <control-panel v-if="site.showControlPanel()" :sisters="sisters" :site="site"/>
      <mansion-setting :site="site"/>
    </div>
  </template>
</template>

<style>
.panel-img {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  -webkit-user-drag: none;
  user-select: none;
}

.panel-img-size {
  width: 1400px;
  max-width: 1400px;
}

.panel-img-box {
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 80px;
  height: 80px;
}
</style>

<style scoped>
.mansion {
  box-sizing: border-box;
  z-index: 9999999;
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
}
</style>