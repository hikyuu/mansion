<script lang="ts" setup>
import { getSite } from '@/site/site'
import { Onejav } from '@/site/onejav/onejav'
import ControlPanel from './ms-control-panel.vue'
import HomeOnejav from '@/components/m-home-onejav.vue'
import MansionSetting from '@/components/m-setting.vue'
import { ElNotification } from 'element-plus'
import MHomeUser from '@/components/m-home-user.vue'
import MsHomeInfo from '@/components/ms-home-info.vue'
import { useReactStore } from '@/store/react-store'
import { useSiteStore } from '@/store/site-store.ts'
import MsDebugPanel from '@/components/ms-debug-panel.vue'
import { useConfigStore } from '@/store/config-store.ts'

const exactSite = getSite()

if (exactSite === undefined) {
  ElNotification({ title: 'mansion', message: `不支持当前网站!`, type: 'error' })
} else {
  useSiteStore().setSite(exactSite)
  console.log(`当前站点: ${exactSite.name}`)

  useConfigStore().$subscribe((mutation, state) => {
    useConfigStore().saveConfig()
  })
  useConfigStore().loadConfig()

  useReactStore().listen()

  exactSite.mount()
}

const site = useSiteStore().getSite

const isDevMode = import.meta.env.DEV
</script>

<template>
  <template v-if="site">
    <div style="padding-left: 5px">
      <ms-home-info />
    </div>
    <div class="mansion-right">
      <m-home-user v-if="useReactStore().wgt1670" />
      <home-onejav v-if="site instanceof Onejav" />
      <control-panel v-if="site.showControlPanel()" />
      <mansion-setting v-if="useReactStore().wgt1670" />
      <ms-debug-panel v-if="isDevMode" />
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
