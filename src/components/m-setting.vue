<script lang="ts" setup>
import { SiteAbstract } from '@/site/site-abstract'
import { Setting } from '@element-plus/icons-vue'
import { ElNotification } from 'element-plus'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { useConfigStore } from '@/store/config-store'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'

const props = defineProps<{
  site: SiteAbstract
}>()
const configStore = useConfigStore()
const { currentConfig } = storeToRefs(configStore)

function scrollStatusChange(value: number) {
  const status = Object.values(WaterfallStatus).find((item) => {
    return item.code === value
  })
  if (!status) {
    ElNotification({ title: '瀑布流', message: `未知状态`, type: 'error' })
  } else {
    ElNotification({ title: '瀑布流', message: status.msg, type: 'info' })
  }
}

function scrollAnimationChange(value: number) {
  if (value) {
    ElNotification({ title: '瀑布流', message: `开启滚动动画`, type: 'info' })
  } else {
    ElNotification({ title: '瀑布流', message: `关闭滚动动画`, type: 'info' })
  }
}

const WaterfallStatus = {
  close: {
    msg: '关闭瀑布流',
    code: 0
  },
  lazy: {
    msg: '开启懒加载模式',
    code: 1
  },
  oneStep: {
    msg: '开始一步到位模式',
    code: 2
  }
}

function loadPreviewSwitchChange(value: boolean) {
  if (value) {
    ElNotification({ title: '瀑布流', message: `加载预览图`, type: 'info' })
  } else {
    ElNotification({ title: '瀑布流', message: `不加载预览图`, type: 'info' })
  }
}

watch(
  () => currentConfig,
  (value) => {
    configStore.waterfall.set(props.site.name, value.value)
  },
  { deep: true }
)

function reload() {
  window.location.reload()
}
function allRead() {
  props.site.allRead()
}
</script>

<template>
  <m-img-box>
    <m-img-item>
      <el-popover
        :width="500"
        placement="left"
        popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
        trigger="hover"
      >
        <template #reference>
          <el-icon :color="props.site.theme.PRIMARY_COLOR" :size="60">
            <Setting />
          </el-icon>
        </template>
        <template #default>
          <el-form label-position="right" label-width="auto">
            <el-form-item label="预览图">
              <el-switch
                v-model="currentConfig.loadPreviewSwitch"
                @change="loadPreviewSwitchChange"
                active-icon="Check"
                inactive-icon="Close"
                inline-prompt
                size="large"
              />
            </el-form-item>
            <el-form-item label="跳过已读">
              <el-switch
                v-model="currentConfig.skipRead"
                active-icon="Check"
                inactive-icon="Close"
                inline-prompt
                size="large"
              />
            </el-form-item>
            <el-form-item label="瀑布流">
              <el-radio-group v-model="currentConfig.scrollStatus" @change="scrollStatusChange">
                <el-radio :value="0" border>关闭</el-radio>
                <el-radio :value="1" border>懒加载</el-radio>
                <el-radio :value="2" border>一步到位</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="滚动动画">
              <el-radio-group v-model="currentConfig.smooth" @change="scrollAnimationChange">
                <el-radio :value="0" border>关</el-radio>
                <el-radio :value="1" border>开</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="导航起点">
              <el-radio-group v-model="currentConfig.navigationPoint">
                <el-radio :value="0" border>标题</el-radio>
                <el-radio :value="1" border>预览</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-row justify="center">
              <el-button type="primary" @click="allRead">全部已读</el-button>
            </el-row>
            <el-row justify="center">
              <el-button type="primary" @click="reload">保存并刷新页面</el-button>
            </el-row>
          </el-form>
        </template>
      </el-popover>
    </m-img-item>
  </m-img-box>
</template>
