---
name: exhentai-hide-thumbnail-switch
overview: 在设置面板中，对 exhentai 站点隐藏“缩略图”开关（该开关对 exhentai 不生效），其他站点保持原样。
todos:
  - id: hide-thumbnail-switch
    content: 在 m-setting.vue 为“缩略图”表单项增加 v-if，exhentai 站点不渲染该项
    status: completed
  - id: verify-changes
    content: 运行 npm run type-check 与 npm run lint，确认改动无新增类型或规范问题
    status: completed
    dependencies:
      - hide-thumbnail-switch
---

## 用户需求

在设置面板中，exhentai 站点不显示“缩略图”开关；其他站点保持现状。

## 产品概述

exhentai 页面不加载缩略图（其站点实现未接入瀑布流缩略图流程），因此“缩略图”开关在 exhentai 上属于无效配置项。将其在设置面板中对 exhentai 隐藏，减少无效选项干扰。

## 核心功能

- 设置面板中“缩略图”开关仅在非 exhentai 站点显示。
- exhentai 站点的其他设置项（跳过已读、隐藏已下载画廊、瀑布流、滚动动画、导航起点、懒加载数量）保持原样，不受影响。
- 配置字段与运行逻辑不变：`loadThumbnailSwitch` 仍保留并按站点持久化，既有配置不会丢失，切回其他站点时开关状态照旧生效。
- 视觉表现：exhentai 的设置浮层中直接不再出现“缩略图”一行，其余表单项自然上移，无空白占位。

## 技术栈

沿用现有工程：Vue 3 + TypeScript + Pinia + Element Plus，userscript 由 vite-plugin-monkey 构建；校验使用 `npm run type-check` 与 `npm run lint`。

## 实现思路

在 `src/components/m-setting.vue` 中已有的“缩略图”`el-form-item` 上增加条件渲染，与同文件第 126 行已存在的 exhentai 条件写法保持一致：

- 现状（已确认）：`<el-form-item label="缩略图">` 包裹 `el-switch`，`v-model="currentConfig.loadThumbnailSwitch"`，`@change="loadThumbnailSwitchChange"`。
- 改动：为该 `el-form-item` 增加 `v-if="site.siteId !== SiteId.EXHENTAI"`。`SiteId` 已在该文件由 `@/site/site-id` 引入，`site` 由 `useSiteStore().getSite` 提供，`siteId` 为 `SiteAbstract` 抽象属性，模板中可直接使用。
- 不改动：`SiteConfig` 字段、`getDefaultSiteConfig()` 默认值、`loadThumbnailSwitchChange` 通知函数、`config-store` 的持久化与合并逻辑。

## 关键设计决策

- **UI 层过滤而非删除配置**：配置项按站点整体保存在 `mansion-config` 中（`SiteConfig` 为通用结构），删除字段会导致旧配置合并与类型维护成本上升，且其他站点仍在使用该开关。只在展示层隐藏是最小、可逆的改动。
- **条件写法复用既有约定**：同文件已用 `siteId === SiteId.EXHENTAI` 控制“隐藏已下载画廊”，本次用取反形式，避免引入新的站点判断方式（如比较 `name` 字符串）。
- **不改运行时逻辑**：`waterfall.ts` 中 `loadThumbnail()` 的读取逻辑保持原样；exhentai 本身不调用 `waterfall.flow()` 且 `resolveElements()` 未实现，隐藏 UI 不改变任何行为。

## 实现要点

- 使用 `v-if` 而非 `v-show`，避免在 DOM 中保留无意义的隐藏表单项。
- 仅调整一个 `el-form-item`，影响范围限于设置浮层渲染；不涉及全局样式、不做无关重构。
- 保持现有代码风格（缩进、属性顺序），不新增日志或通知。

## 目录结构

```
mansion/
└── src/
    └── components/
        └── m-setting.vue   # [MODIFY] 为“缩略图”表单项增加 v-if="site.siteId !== SiteId.EXHENTAI"，使该开关仅在非 exhentai 站点显示；其余表单项、SiteConfig 字段与持久化逻辑保持不变
```