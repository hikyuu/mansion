<script lang="ts" setup>
import { defineProps } from 'vue'
import { SiteAbstract } from '@/site/site-abstract'
import type { Sister } from '@/site/sister'
import { detailUrl } from '@/site/javdb/javdb-api'
import { BASEURL } from '@/dictionary'
import { ElNotification } from 'element-plus'
import { Hide, Star } from '@element-plus/icons-vue'

const props = defineProps<{
  site: SiteAbstract
  sister: Sister
}>()
function openJavDB() {
  if (props.sister.current_key === undefined) return
  detailUrl(props.sister.current_key)
    .then((url) => {
      console.log(BASEURL.JAVDB + url)
      window.open(BASEURL.JAVDB + url, '_blank')
    })
    .catch((reason) => {
      ElNotification({ title: 'javdb', message: reason, type: 'error' })
    })
}
function haveLike() {
  if (props.sister.current_index === undefined) return false
  const sister = props.sister.queue[props.sister.current_index]
  if (sister.likeWords === undefined) return false
  return sister.likeWords.length > 0
}
function haveUnlike() {
  if (props.sister.current_index === undefined) return false
  const sister = props.sister.queue[props.sister.current_index]
  if (sister.unlikeWords === undefined) return false
  return sister.unlikeWords.length > 0
}
</script>
<template>
  <el-card style="max-width: 160px" v-if="sister.current_index != undefined">
    <el-row>
      <el-text style="font-size: 20px" tag="b">{{ sister.current_key }}</el-text>
      <el-link
        type="danger"
        v-if="sister.queue[sister.current_index].javStoreUrl"
        :href="sister.queue[sister.current_index].javStoreUrl"
        style="font-size: 20px"
        target="_blank"
        >JavStore
      </el-link>
      <el-link type="primary" style="font-size: 20px" @click="openJavDB">Javdb</el-link>
    </el-row>
    <el-row>
      <el-text type="danger" v-if="haveLike()">
        <el-icon>
          <Star />
        </el-icon>
        like
        <li v-for="word in sister.queue[sister.current_index].likeWords" :key="word">
          {{ word }}
        </li>
      </el-text>
    </el-row>
    <el-row>
      <el-text type="info" v-if="haveUnlike()">
        <el-icon>
          <Hide />
        </el-icon>
        unlike
        <li v-for="word in sister.queue[sister.current_index].unlikeWords" :key="word">
          {{ word }}
        </li>
      </el-text>
    </el-row>
    <el-row>
      <el-text v-if="site.downloadList.size > 0" style="font-size: 15px">
        [下载列表]
        <li v-for="(entry, index) in Array.from(site.downloadList.entries())" :key="index">
          {{ entry[0] }}
        </li>
      </el-text>
    </el-row>
  </el-card>
</template>
