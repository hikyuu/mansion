<script lang="ts" setup>
import { SiteAbstract } from '@/site/site-abstract'
import { Setting } from '@element-plus/icons-vue'
import { toRef, watch } from 'vue'
import { GM_setValue } from 'vite-plugin-monkey/dist/client'
import { ElNotification } from 'element-plus'

const props = defineProps<{
  site: SiteAbstract
}>()

const whetherToLoadPreview = toRef(props.site.waterfall.whetherToLoadPreview)
const waterfallScrollStatus = toRef(props.site.waterfall.waterfallScrollStatus)

watch(waterfallScrollStatus, (value: number) => {
  GM_setValue('waterfallScrollStatus', value)
  switch (value) {
    case 0:
      ElNotification({ title: '瀑布流', message: `关闭瀑布流`, type: 'info' })
      break
    case 1:
      ElNotification({ title: '瀑布流', message: `开启懒加载`, type: 'info' })
      break
    case 2:
      ElNotification({ title: '瀑布流', message: `开启一步到位模式`, type: 'info' })
      break
    default:
      ElNotification({ title: '瀑布流', message: `未知状态`, type: 'info' })
  }
})
watch(whetherToLoadPreview, (value: boolean) => {
  GM_setValue('whetherToLoadPreview', value)
  if (value) {
    ElNotification({ title: '瀑布流', message: `加载预览图`, type: 'info' })
  } else {
    ElNotification({ title: '瀑布流', message: `不加载预览图`, type: 'info' })
  }
})
</script>

<template>
  <div class="panel-img">
    <div class="panel-img-box">
      <el-popover
        :width="500"
        placement="left"
        popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
        trigger="hover"
      >
        <template #reference>
          <el-icon :color="props.site.theme.primary_color" :size="60">
            <Setting />
          </el-icon>
        </template>
        <template #default>
          <el-form label-position="right" label-width="100px" style="max-width: 460px">
            <el-form-item label="预览图">
              <el-switch
                v-model="whetherToLoadPreview"
                active-icon="Check"
                inactive-icon="Close"
                inline-prompt
                size="large"
              />
            </el-form-item>
            <el-form-item label="瀑布流">
              <el-radio-group v-model="waterfallScrollStatus">
                <el-radio :label="0" border>关闭</el-radio>
                <el-radio :label="1" border>懒加载</el-radio>
                <el-radio :label="2" border>一步到位</el-radio>
              </el-radio-group>
            </el-form-item>
          </el-form>
        </template>
      </el-popover>
    </div>
  </div>
</template>
