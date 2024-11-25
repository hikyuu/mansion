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
import { detailUrl } from '@/site/javdb/javdb-api'
import { BASEURL } from '@/dictionary'

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

function openJavDB() {
  if (sisters.current_key === undefined) return
  detailUrl(sisters.current_key)
    .then((url) => {
      console.log(BASEURL.JAVDB + url)
      window.open(BASEURL.JAVDB + url, '_blank')
    })
    .catch((reason) => {
      ElNotification({ title: 'javdb', message: reason, type: 'error' })
    })
}
</script>

<template>
  <template v-if="site">
    <div class="mansion-left" style="padding-left: 5px">
      <el-card style="max-width: 160px" v-if="sisters.current_index != undefined">
        <el-text style="font-size: 20px" tag="b">{{ sisters.current_key }}</el-text>
        <el-link
          type="danger"
          v-if="sisters.queue[sisters.current_index].javStoreUrl"
          :href="sisters.queue[sisters.current_index].javStoreUrl"
          style="font-size: 20px"
          target="_blank"
          >JavStore
        </el-link>
        <el-link type="primary" style="font-size: 20px" @click="openJavDB">Javdb </el-link>
      </el-card>
    </div>
    <div class="mansion-right">
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
.mansion-right {
  box-sizing: border-box;
  position: fixed;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
}
.mansion-left {
  box-sizing: border-box;
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
}
</style>
