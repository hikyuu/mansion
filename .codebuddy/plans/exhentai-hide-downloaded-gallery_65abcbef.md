---
name: exhentai-hide-downloaded-gallery
overview: 在设置面板中为 exhentai 新增“隐藏已下载画廊”开关（默认关闭）：开启后，已下载且无新版本（archive 状态 200）的画廊整条隐藏，替代当前仅隐藏下载按钮的行为。
todos:
  - id: config-field
    content: 在 config-store.ts 的 SiteConfig 与默认配置中新增 hideDownloadedGallery（默认 false）
    status: completed
  - id: setting-switch
    content: 在 m-setting.vue 增加仅 exhentai 显示的“隐藏已下载画廊”开关并绑定配置
    status: completed
    dependencies:
      - config-field
  - id: exhentai-hide
    content: 在 exhentai.ts 的“已下载且无新版本”分支按开关隐藏整条画廊或仅下载按钮
    status: completed
    dependencies:
      - config-field
  - id: verify-build
    content: 运行 npm run type-check 与 npm run lint 验证改动无类型与规范问题
    status: completed
    dependencies:
      - setting-switch
      - exhentai-hide
---

## 用户需求

在 exhentai 站点的设置面板中新增“隐藏已下载画廊”开关，并且该开关仅在 exhentai 页面显示。

## 产品概述

现有行为：当某画廊已下载成功且无更新版本（归档状态 200）时，脚本只把该条目上的下载按钮隐藏，画廊条目本身仍留在列表中。

新增一个可选开关，把“只隐藏下载按钮”升级为“隐藏整条画廊”，让用户可以直接过滤掉已下载过的条目。

## 核心功能

- 设置面板新增“隐藏已下载画廊”开关：
- 仅在 exhentai 站点显示，其他站点不出现该项。
- 默认关闭，关闭时保持现状（仅隐藏下载按钮）。
- 与现有设置项一致：切换后点击“保存并刷新页面”生效，配置按站点持久化保存。
- 开启后的行为：
- 归档状态为“已下载且无新版本（200）”的画廊，整条卡片（封面、标题、日期、下载按钮等）从列表中隐藏。
- 归档状态为“仅过时种子（304）”的条目仍保持原有表现：下载按钮置灰并自动复查。
- 用户手动标记“跳过下载（400）”的条目仍只受原“跳过已读”开关控制。
- 视觉表现：开启后列表中原有的已下载画廊整体消失，剩余画廊自然补位，不出现空白占位；关闭开关并刷新后，画廊重新显示（此时只有下载按钮被隐藏）。

## 技术栈

沿用现有工程栈：Vue 3 + TypeScript + Pinia + Element Plus + jQuery，userscript 由 vite-plugin-monkey 构建（`npm run build` / `npm run type-check` 校验）。

## 实现思路

改动集中在三层，保持最小侵入：

1. **配置层**（`src/store/config-store.ts`）：在 `SiteConfig` 中新增 `hideDownloadedGallery: boolean`，并在 `getDefaultSiteConfig()` 里默认 `false`。`loadConfig()` 已使用 `Object.assign(siteConfig, userSiteConfig)` 合并旧配置，因此老用户缺失该字段时会自动取默认值，**无需数据迁移**。
2. **设置界面**（`src/components/m-setting.vue`）：在“跳过已读”之后插入一个 `el-form-item`，用 `v-if="site.siteId === SiteId.EXHENTAI"` 控制仅 exhentai 可见；`el-switch` 绑定 `currentConfig.hideDownloadedGallery`，样式与现有开关（`active-icon="Check"`、`inline-prompt`、`size="large"`）一致；可选地参照 `loadThumbnailSwitchChange` 增加一条 `ElNotification` 提示，保持交互一致性。由于页面已通过 `useConfigStore().$subscribe` 自动下刷配置，且“保存并刷新页面”会显式 `saveConfig()`，持久化链路无需改动。
3. **生效逻辑**（`src/site/exhentai/exhentai.ts`）：在 `attachHandlersForInfos()` 开头一次性读取 `useConfigStore().getSiteConfig.hideDownloadedGallery`，在 `HentaiArchiveStatus.DownloadSuccess` 且 `isNewer === false` 的分支中，将原来的 `$download.hide()` 改为条件隐藏——开关开启时为 `$item.hide()`，否则维持 `$download.hide()`，随后仍然 `continue`（不入队、不绑定下载点击）。

## 关键设计决策

- **整条隐藏而非移除 DOM**：沿用现有 `SkipDownload + skipRead` 的 `$item.hide()` 写法，DOM 与 `id="exhentai_gid_{gid}"` 保留，避免影响按 `#exhentai_gid_*` 定位的队列执行器与后续可能的调试；`.itg.gld` 为 CSS Grid，`display:none` 的网格项不占位，布局自动回流。
- **配置放在 `SiteConfig`（按站点）而非 `common`**：天然实现“仅 exhentai”，其他站点即使存在该字段也不读取，不产生副作用。
- **不改 304/400 分支**：与用户确认的范围一致，避免改变自动复查与跳过逻辑的既有语义。

## 实现要点

- exhentai 的 `mount()` 不调用 `waterfall.flow()`（`resolveElements` 未实现），条目只在首屏 `collectItemInfos()` 时处理一次，因此只需在 `attachHandlersForInfos` 中读取一次配置即可，无需处理分页追加场景，也无重复读取配置的额外开销。
- 保持现有日志风格（`console.log/error`），不新增敏感信息输出；隐藏操作失败不应中断其他条目的处理（现有 try/catch 结构已覆盖 DOM 操作）。
- 控制影响范围：只改上述三处，不动下载判重口径（`resolveArchiveWaterline`）、下载处理器与队列逻辑。
- 兼容性：新增字段有默认值，旧 `mansion-config` 可直接读取；关闭开关时行为与当前版本完全一致。

## 目录结构

```
mansion/
├── src/
│   ├── store/
│   │   └── config-store.ts        # [MODIFY] SiteConfig 增加 hideDownloadedGallery: boolean；getDefaultSiteConfig 增加默认值 false
│   ├── components/
│   │   └── m-setting.vue          # [MODIFY] 在 el-form 中新增“隐藏已下载画廊”开关，v-if 限定 exhentai（site.siteId === SiteId.EXHENTAI），绑定 currentConfig.hideDownloadedGallery，可选加 change 通知
│   └── site/
│       └── exhentai/
│           └── exhentai.ts        # [MODIFY] attachHandlersForInfos 读取 hideDownloadedGallery；DownloadSuccess 且无新版本分支按开关隐藏 $item 或 $download
```