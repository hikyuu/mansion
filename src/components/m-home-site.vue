<script lang="ts" setup>
import { getSite } from '@/site'
import { onMounted, ref } from 'vue'
import { Sisters } from '@/site/sisters'
import { SiteAbstract } from '@/site/site-abstract'
import { Onejav } from '@/site/onejav/onejav'
import ControlPanel from './m-control-panel.vue'
import HomeOnejav from '@/components/m-home-onejav.vue'
import MansionSetting from '@/components/m-setting.vue'

const site = ref<SiteAbstract>()

const sisters = ref<Sisters>(new Sisters())

onMounted(() => {
  const exactSite = getSite(sisters.value)
  if (exactSite === undefined) {
    console.log(`不支持当前网站!`)
    return
  }
  site.value = exactSite

  site.value.mount()
})
</script>

<template>
  <template v-if="site">
    <div class="mansion">
      <home-onejav v-if="site instanceof Onejav" :onejav="site" />
      <control-panel v-if="site.showControlPanel()" :sisters="sisters" :site="site" />
      <mansion-setting :site="site" />
    </div>
  </template>
</template>

<style>
.panel-img-size {
  width: 1400px;
  max-width: 1400px;
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
