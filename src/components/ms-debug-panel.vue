<script setup lang="ts">
import { SwitchFilled } from '@element-plus/icons-vue'
import MImgItem from '@/components/m-img-item.vue'
import MImgBox from '@/components/m-img-box.vue'
import { useSiteStore } from '@/store/site-store.ts'

const props = defineProps({
  size: {
    type: Number,
    default: 60
  }
})
const site = useSiteStore().getSite
</script>

<template>
  <m-img-box>
    <m-img-item>
      <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
        <SwitchFilled />
      </el-icon>
    </m-img-item>
  </m-img-box>
</template>

<style scoped></style>
