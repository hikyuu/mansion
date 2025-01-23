<script lang="ts" setup>
import { computed, defineProps, ref } from 'vue'
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

const haveLike = computed(() => {
  if (props.sister.current_index === undefined) return false
  const sister = props.sister.queue[props.sister.current_index]
  if (sister.likeWords === undefined) return false
  return sister.likeWords.length > 0
})
const haveUnlike = computed(() => {
  if (props.sister.current_index === undefined) return false
  const sister = props.sister.queue[props.sister.current_index]
  if (sister.unlikeWords === undefined) return false
  return sister.unlikeWords.length > 0
})

const isDesktop = ref(window.innerWidth >= 1670)

window.addEventListener('resize', () => {
  isDesktop.value = window.innerWidth >= 1670
})
</script>
<template>
  <template v-if="sister.current_index != undefined">
    <el-card style="max-width: 160px" class="mansion-left" v-if="isDesktop">
      <el-row>
        <el-text truncated style="font-size: 20px" tag="b">{{ sister.current_key }}</el-text>
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
        <el-text type="danger" v-if="haveLike">
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
        <el-text type="info" v-if="haveUnlike">
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
    <div v-else style="background-color: white" class="mansion-bottom">
      <el-row style="min-height: 3.25rem" justify="space-between">
        <template v-if="sister.current_index != undefined">
          <el-col :span="6" class="flex-space">
            <el-text truncated style="font-size: 20px" tag="b">{{ sister.current_key }}</el-text>
            <el-link
              type="danger"
              v-if="sister.queue[sister.current_index].javStoreUrl"
              :href="sister.queue[sister.current_index].javStoreUrl"
              style="font-size: 20px"
              target="_blank"
              >JavStore
            </el-link>
            <el-link type="primary" style="font-size: 20px" @click="openJavDB">Javdb</el-link>
          </el-col>
          <el-col :span="12" class="flex-space">
            <el-text size="large" type="danger" v-if="haveLike">
              <el-tag v-for="(word, index) in sister.queue[sister.current_index].likeWords" :key="index" type="danger">
                {{ word }}
              </el-tag>
            </el-text>
            <el-text size="large" type="info" v-if="haveUnlike">
              <el-tag v-for="(word, index) in sister.queue[sister.current_index].unlikeWords" :key="index" type="info">
                {{ word }}
              </el-tag>
            </el-text>
            <el-text style="font-size: 15px" v-if="site.downloadList.size > 0">
              [下载列表]
              <el-tag type="" v-for="(entry, index) in Array.from(site.downloadList.entries())" :key="index">
                {{ entry[0] }}
              </el-tag>
            </el-text>
          </el-col>
          <el-col :span="6" class="flex-space"> </el-col>
        </template>
      </el-row>
    </div>
  </template>
</template>
<style scoped>
.mansion-left {
  position: fixed;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
}
.mansion-bottom {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
}
.flex-space {
  display: flex;
  justify-content: space-evenly;
  align-items: center;
  flex-wrap: wrap;
}
</style>
