<template>
  <div class="panel-img">
    <div class="panel-img-box">
      <el-popover
          :width="500"
          placement="left"
          popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
          trigger="hover">
        <template #reference>
          <el-icon :color="props.site.theme.primary_color" :size="60">
            <Setting/>
          </el-icon>
        </template>
        <template #default>
          <el-form
              label-position="right"
              label-width="100px"
              style="max-width: 460px"
          >
            <el-form-item label="加载预览图">
              <el-switch
                  v-model="props.site.waterfall.whetherToLoadPreview as any"
                  :active-icon="Check"
                  :inactive-icon="Close"
                  inline-prompt
                  size="large"
              />
            </el-form-item>
            <el-form-item label="瀑布流">
              <el-radio-group v-model="props.site.waterfall.waterfallScrollStatus as any">
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
<script lang="ts" setup>
import {SiteAbstract} from "../site/site-abstract";
import {Check, Close, Setting} from "@element-plus/icons-vue";

const props = defineProps<{
  site: SiteAbstract
}>()
</script>