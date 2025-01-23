<script lang="ts" setup>
import { getSite } from '@/site'
import { reactive, ref } from 'vue'
import { Sister } from '@/site/sister'
import { SiteAbstract } from '@/site/site-abstract'
import { Onejav } from '@/site/onejav/onejav'
import ControlPanel from './ms-control-panel.vue'
import HomeOnejav from '@/components/m-home-onejav.vue'
import MansionSetting from '@/components/m-setting.vue'
import { useConfigStore } from '@/store/config-store'
import { ElNotification } from 'element-plus'
import MHomeUser from '@/components/m-home-user.vue'
import MsHomeInfo from '@/components/ms-home-info.vue'

const site = ref<SiteAbstract>()

const sister = reactive<Sister>(new Sister())

const configStore = useConfigStore()
const exactSite = getSite(sister)
if (exactSite === undefined) {
  ElNotification({ title: 'mansion', message: `不支持当前网站!`, type: 'error' })
} else {
  site.value = exactSite

  configStore.$subscribe((mutation, state) => {
    configStore.saveLocal()
  })

  configStore.loadLocalConfig(exactSite.name)

  exactSite.mount()
}
</script>

<template>
  <template v-if="site">
    <div style="padding-left: 5px">
      <ms-home-info :sister="sister" :site="site" />
    </div>
    <div class="mansion-right">
      <m-home-user :site="site" />
      <home-onejav v-if="site instanceof Onejav" :onejav="site" />
      <control-panel v-if="site.showControlPanel()" :sister="sister" :site="site" />
      <mansion-setting :site="site" />
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
