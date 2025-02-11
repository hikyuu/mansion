<script lang="ts" setup>
import { computed, defineProps } from 'vue'
import { SiteAbstract } from '@/site/site-abstract'
import { detailUrl } from '@/site/javdb/javdb-api'
import { BASEURL } from '@/dictionary'
import { ElNotification } from 'element-plus'
import { Hide, Star } from '@element-plus/icons-vue'
import { Onejav } from '@/site/onejav/onejav'
import MHomeUser from '@/components/m-home-user.vue'
import MSetting from '@/components/m-setting.vue'
import MSisterStatistics from '@/components/m-sister-statistics.vue'
import MOnejavCalendar from '@/components/m-onejav-calendar.vue'
import { useReactStore } from '@/store/react-store'
import { useSisterStore } from '@/store/sister-store'
const sisters = useSisterStore()

const props = defineProps<{
  site: SiteAbstract
}>()
function openJavDB() {
  const currentKey = sisters.current_key
  if (currentKey === undefined) return
  detailUrl(currentKey)
    .then((url) => {
      console.log(BASEURL.JAVDB + url)
      window.open(BASEURL.JAVDB + url, '_blank')
    })
    .catch((reason) => {
      ElNotification({ title: 'javdb', message: reason, type: 'error' })
    })
}

const haveLike = computed(() => {
  const info = sisters.currentSister
  if (info === undefined) return false
  if (info.likeWords === undefined) return false
  return info.likeWords.length > 0
})
const haveUnlike = computed(() => {
  const info = sisters.currentSister
  if (info === undefined) return false
  if (info.unlikeWords === undefined) return false
  return info.unlikeWords.length > 0
})
</script>
<template>
  <el-card v-if="sisters.currentSister && useReactStore().wgt1670" style="max-width: 160px" class="mansion-left">
    <el-row>
      <el-text truncated style="font-size: 20px" tag="b">{{ sisters.current_key }}</el-text>
      <el-link
        type="danger"
        v-if="sisters.currentSister.javStoreUrl"
        :href="sisters.currentSister.javStoreUrl"
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
        <li v-for="word in sisters.currentSister.likeWords" :key="word">
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
        <li v-for="word in sisters.currentSister.unlikeWords" :key="word">
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

  <div v-if="!useReactStore().wgt1670" style="background-color: white" class="mansion-bottom">
    <el-row style="min-height: 3.25rem" justify="space-between">
      <el-col :span="6" class="flex-space">
        <template v-if="sisters.currentSister">
          <el-text truncated style="font-size: 20px" tag="b">{{ sisters.current_key }}</el-text>
          <el-link
            type="danger"
            v-if="sisters.currentSister.javStoreUrl"
            :href="sisters.currentSister.javStoreUrl"
            style="font-size: 20px"
            target="_blank"
            >JavStore
          </el-link>
          <el-link type="primary" style="font-size: 20px" @click="openJavDB">Javdb</el-link>
        </template>
      </el-col>
      <el-col :span="12" class="flex-space">
        <template v-if="sisters.currentSister">
          <el-text size="large" type="danger" v-if="haveLike">
            <el-tag v-for="(word, index) in sisters.currentSister.likeWords" :key="index" type="danger">
              {{ word }}
            </el-tag>
          </el-text>
          <el-text size="large" type="info" v-if="haveUnlike">
            <el-tag v-for="(word, index) in sisters.currentSister.unlikeWords" :key="index" type="info">
              {{ word }}
            </el-tag>
          </el-text>
          <el-text style="font-size: 15px" v-if="site.downloadList.size > 0">
            [下载列表]
            <el-tag v-for="(entry, index) in Array.from(site.downloadList.entries())" :key="index">
              {{ entry[0] }}
            </el-tag>
          </el-text>
        </template>
      </el-col>
      <el-col :span="6" class="flex-space">
        <m-sister-statistics
          v-if="sisters.current_index != undefined"
          :sister="sisters"
          :site="site"
          :size="25"
          style="height: 50px"
        />
        <m-home-user :site="site" :size="40" />
        <m-onejav-calendar v-if="site instanceof Onejav" :onejav="site" :size="40" />
        <m-setting :site="site" :size="40" />
      </el-col>
    </el-row>
  </div>
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
