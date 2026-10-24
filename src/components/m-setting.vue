<script lang="ts" setup>
import { computed, ref } from 'vue'
import { Setting } from '@element-plus/icons-vue'
import { ElNotification } from 'element-plus'
import MImgBox from '@/components/m-img-box.vue'
import MImgItem from '@/components/m-img-item.vue'
import { useSiteStore } from '@/store/site-store.ts'
import { useConfigStore, type DownloadMethod } from '@/store/config-store.ts'
import { SiteId } from '@/site/site-id'
import { fetchMiaoSavePaths, miaoHealth, type MiaoHealthResult } from '@/download/miao.ts'

const props = defineProps({
  size: {
    type: Number,
    default: 60
  }
})

const site = useSiteStore().getSite
const configStore = useConfigStore()
const currentConfig = configStore.getSiteConfig
const miaoConfig = configStore.common.miao

const downloadMethodLabels: Record<DownloadMethod, string> = {
  miao: 'miao 优先（失败自动回退迅雷）',
  thunder: '迅雷协议',
  copy: '复制链接'
}

function downloadMethodChange(value: DownloadMethod) {
  ElNotification({ title: '下载方式', message: downloadMethodLabels[value] ?? String(value), type: 'info' })
}

const testingMiao = ref(false)
const miaoHealthResult = ref<MiaoHealthResult | null>(null)

/** miao 下载目录白名单（用于「下载目录」下拉，避免与 savePaths 字面不一致） */
const savePathOptions = ref<string[]>([])
const savePathLoading = ref(false)
/** 读取白名单失败（未启动 / 启用 token）：降级为手动输入 */
const savePathLoadFailed = ref(false)
/** 已成功读取过白名单，避免每次悬浮设置面板都重复请求 */
const savePathLoaded = ref(false)

async function loadSavePathOptions(force = false) {
  if (currentConfig.downloadMethod !== 'miao' || savePathLoading.value) return
  if (savePathLoaded.value && !force) return
  savePathLoading.value = true
  try {
    const { savePaths, defaultSavePath } = await fetchMiaoSavePaths()
    const merged: string[] = []
    if (defaultSavePath) merged.push(defaultSavePath)
    for (const path of savePaths) {
      if (!merged.includes(path)) merged.push(path)
    }
    savePathOptions.value = merged
    savePathLoadFailed.value = merged.length === 0
    savePathLoaded.value = true
  } catch (e) {
    console.error('读取 miao 下载目录白名单失败', e)
    savePathOptions.value = []
    savePathLoadFailed.value = true
  } finally {
    savePathLoading.value = false
  }
}

/** Windows 路径粗归一化：斜杠方向、结尾反斜杠、大小写，避免误报“不在白名单” */
function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase()
}

/** 当前填写的目录不在白名单内（必然 403 SAVE_PATH_NOT_ALLOWED） */
const savePathInvalid = computed(() => {
  const value = miaoConfig.savePath.trim()
  if (!value || savePathOptions.value.length === 0) return false
  const target = normalizePath(value)
  return !savePathOptions.value.some((option) => normalizePath(option) === target)
})

async function testMiaoConnection() {
  testingMiao.value = true
  miaoHealthResult.value = null
  try {
    const result = await miaoHealth()
    miaoHealthResult.value = result
    ElNotification({ title: 'miao 连接测试', message: result.message, type: result.type })
    // 顺带刷新白名单下拉，避免用户改过 miao 设置后还要刷新页面
    if (result.ok) void loadSavePathOptions(true)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    miaoHealthResult.value = { ok: false, type: 'error', message }
    ElNotification({ title: 'miao 连接测试', message, type: 'error' })
  } finally {
    testingMiao.value = false
  }
}

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

function loadThumbnailSwitchChange(value: boolean) {
  if (value) {
    ElNotification({ title: '瀑布流', message: `加载缩略图`, type: 'info' })
  } else {
    ElNotification({ title: '瀑布流', message: `不加载缩略图`, type: 'info' })
  }
}

function onlyShowDownloadableChange(value: boolean) {
  if (value) {
    ElNotification({ title: 'ExHentai', message: `仅显示可下载的画廊`, type: 'info' })
  } else {
    ElNotification({ title: 'ExHentai', message: `显示全部画廊`, type: 'info' })
  }
}

// watch(
//   () => currentConfig,
//   (value) => {
//     configStore.config.set(site.name, value.value)
//   },
//   { deep: true }
// )

function reload() {
  // 先保存配置再刷新
  try {
    configStore.saveConfig()
  } catch {
    // ignore
  }
  window.location.reload()
}
function allRead() {}
</script>

<template>
  <m-img-box>
    <m-img-item>
      <el-popover
        :width="500"
        placement="left"
        popper-style="box-shadow: rgb(14 18 22 / 35%) 0px 10px 38px -10px, rgb(14 18 22 / 20%) 0px 10px 20px -15px; padding: 20px;"
        trigger="hover"
        @after-enter="loadSavePathOptions"
      >
        <template #reference>
          <el-icon :color="site.theme.PRIMARY_COLOR" :size="props.size">
            <Setting />
          </el-icon>
        </template>
        <template #default>
          <el-form label-position="right" label-width="auto">
            <el-form-item label="缩略图">
              <el-switch
                v-model="currentConfig.loadThumbnailSwitch"
                @change="loadThumbnailSwitchChange"
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
            <el-form-item v-if="site.siteId === SiteId.EXHENTAI" label="仅显示可下载">
              <el-switch
                v-model="currentConfig.onlyShowDownloadable"
                @change="onlyShowDownloadableChange"
                active-icon="Check"
                inactive-icon="Close"
                inline-prompt
                size="large"
              />
            </el-form-item>
            <el-form-item label="瀑布流">
              <el-radio-group v-model="currentConfig.scrollStatus" @change="scrollStatusChange">
                <el-radio style="width: 100px" :value="0" border>关闭</el-radio>
                <el-radio style="width: 100px" :value="1" border>懒加载</el-radio>
                <el-radio style="width: 100px" :value="2" border>一步到位</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="滚动动画">
              <el-radio-group v-model="currentConfig.smooth" @change="scrollAnimationChange">
                <el-radio style="width: 100px" :value="0" border>关</el-radio>
                <el-radio style="width: 100px" :value="1" border>开</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="导航起点">
              <el-radio-group v-model="currentConfig.navigationPoint">
                <el-radio style="width: 100px" :value="0" border>标题</el-radio>
                <el-radio style="width: 100px" :value="1" border>缩略</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="懒加载数量">
              <el-input-number
                v-model="currentConfig.lazyLimit"
                :min="1"
                :step="10"
                size="large"
                controls-position="right"
              />
            </el-form-item>
            <el-form-item label="下载方式">
              <el-radio-group v-model="currentConfig.downloadMethod" @change="downloadMethodChange">
                <el-radio style="width: 100px" value="miao" border>miao 优先</el-radio>
                <el-radio style="width: 100px" value="thunder" border>迅雷</el-radio>
                <el-radio style="width: 100px" value="copy" border>复制</el-radio>
              </el-radio-group>
            </el-form-item>
            <template v-if="currentConfig.downloadMethod === 'miao'">
              <el-form-item label="下载目录">
                <div style="width: 100%">
                  <el-select
                    v-if="savePathOptions.length > 0"
                    v-model="miaoConfig.savePath"
                    :loading="savePathLoading"
                    placeholder="留空使用 miao 默认下载目录"
                    clearable
                    filterable
                    style="width: 100%"
                  >
                    <el-option v-for="path in savePathOptions" :key="path" :label="path" :value="path" />
                  </el-select>
                  <el-input
                    v-else
                    v-model="miaoConfig.savePath"
                    :placeholder="savePathLoading ? '正在读取 miao 下载目录白名单…' : '留空使用 miao 默认下载目录'"
                    clearable
                  />
                  <el-text v-if="savePathInvalid" type="danger" size="small">
                    当前目录不在 miao 白名单内，建任务会被拒绝（403 SAVE_PATH_NOT_ALLOWED）
                  </el-text>
                  <el-text v-else-if="savePathLoadFailed" type="warning" size="small">
                    未读取到 miao 下载目录白名单（服务未启动或已启用 token），请手动填写
                  </el-text>
                  <el-text v-else-if="savePathOptions.length > 0" type="info" size="small">
                    选项来自 miao 的 savePaths 白名单，清空则使用服务端默认下载目录
                  </el-text>
                </div>
              </el-form-item>
              <el-form-item label="服务地址">
                <el-input v-model="miaoConfig.baseUrl" placeholder="http://127.0.0.1:6427" clearable />
              </el-form-item>
              <el-form-item label="连接测试">
                <el-button type="primary" plain :loading="testingMiao" @click="testMiaoConnection">测试连接</el-button>
                <el-text
                  v-if="miaoHealthResult"
                  :type="miaoHealthResult.type"
                  size="small"
                  style="margin-left: 8px"
                >
                  {{ miaoHealthResult.message }}
                </el-text>
              </el-form-item>
            </template>
            <el-row v-if="false" justify="center">
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

<style scoped>
.el-row {
  margin-bottom: 18px;
}

.el-row:last-child {
  margin-bottom: 0;
}
</style>
