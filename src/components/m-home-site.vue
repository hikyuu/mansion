<script lang="ts" setup>
import { getSite } from '@/site'
import { reactive, ref } from 'vue'
import { Sisters } from '@/site/sisters'
import { SiteAbstract } from '@/site/site-abstract'
import { Onejav } from '@/site/onejav/onejav'
import ControlPanel from './m-control-panel.vue'
import HomeOnejav from '@/components/m-home-onejav.vue'
import MansionSetting from '@/components/m-setting.vue'
import { useConfigStore } from '@/store/config-store'
import { ElNotification } from 'element-plus'

const site = ref<SiteAbstract>()

const sisters = reactive<Sisters>(new Sisters())

const configStore = useConfigStore()
const exactSite = getSite(sisters)
if (exactSite === undefined) {
  ElNotification({ title: 'mansion', message: `不支持当前网站!`, type: 'error' })
} else {
  site.value = exactSite
  configStore.loadLocalConfig(exactSite.name)

  configStore.$subscribe((mutation, state) => {
    configStore.saveLocal()
  })
  exactSite.mount()
}
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

<style scoped>
.panel-img-size {
  width: 1400px;
  max-width: 1400px;
}
.mansion {
  box-sizing: border-box;
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
}
</style>
