<script lang="ts" setup>
import { getSite } from '@/site/site'
import { ref } from 'vue'
import { SiteAbstract } from '@/site/site-abstract'
import { Onejav } from '@/site/onejav/onejav'
import ControlPanel from './ms-control-panel.vue'
import HomeOnejav from '@/components/m-home-onejav.vue'
import MansionSetting from '@/components/m-setting.vue'
import { useConfigStore } from '@/store/config-store'
import { ElNotification } from 'element-plus'
import MHomeUser from '@/components/m-home-user.vue'
import MsHomeInfo from '@/components/ms-home-info.vue'
import { useReactStore } from '@/store/react-store'

const site = ref<SiteAbstract>()

const configStore = useConfigStore()
const exactSite = getSite()
if (exactSite === undefined) {
  ElNotification({ title: 'mansion', message: `不支持当前网站!`, type: 'error' })
} else {
  site.value = exactSite

  configStore.$subscribe((mutation, state) => {
    configStore.saveLocal()
  })

  configStore.loadLocalConfig(exactSite.name)

  useReactStore().listen()

  exactSite.mount()
}
</script>

<template>
  <template v-if="site">
    <div style="padding-left: 5px">
      <ms-home-info :site="site" />
    </div>
    <div class="mansion-right">
      <m-home-user v-if="useReactStore().wgt1670" :site="site" />
      <home-onejav v-if="site instanceof Onejav" :onejav="site" />
      <control-panel v-if="site.showControlPanel()" :site="site" />
      <mansion-setting v-if="useReactStore().wgt1670" :site="site" />
    </div>
  </template>
</template>

<style scoped>
.panel-img-size {
  width: 1400px;
  max-width: 1400px;
}
.mansion-right {
  box-sizing: border-box;
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
}
</style>
