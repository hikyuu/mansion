<script setup lang="ts">

import HomeBar from "./home-bar.vue";
import {getSite} from "../site";
import {onBeforeMount, Ref, ref} from "vue";
import ControlBar from "./control-bar.vue";
import {Sisters} from "../site/sisters";
import {SiteAbstract} from "../site/site-abstract";

type siteInstance = InstanceType<typeof SiteAbstract>
const site = ref<siteInstance>() as Ref<siteInstance>

const sisters = ref<Sisters>(new Sisters());

onBeforeMount(() => {
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
      <home-bar/>
    </div>
    <control-bar v-if="site.whetherToDisplay()" :sisters="sisters" :site="site"/>
  </template>
</template>

<style scoped>
.mansion {
  box-sizing: border-box;
  z-index: 9999999;
  position: fixed;
  top: 50%;
  right: 20px;
  transform: translateY(-50%);
}
</style>