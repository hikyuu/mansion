---
name: exhentai-only-show-downloadable
overview: 将 exhentai 的“隐藏已下载画廊”开关升级并重命名为“仅显示可下载”：开启后只保留可点击下载的画廊，200 无新版本 / 304 过时种子 / 400 跳过下载及无下载按钮的条目整条隐藏；304 仍静默自动复查最新种子。
todos:
  - id: config-field
    content: config-store.ts 用 onlyShowDownloadable 替换旧字段并在 loadConfig 中迁移旧值
    status: completed
  - id: setting-ui
    content: m-setting.vue 将开关改为“仅显示可下载”并绑定新字段与提示
    status: completed
    dependencies:
      - config-field
  - id: exhentai-logic
    content: exhentai.ts 按开关隐藏 200/304/400 及无下载按钮条目，304 仍入队复查
    status: completed
    dependencies:
      - config-field
  - id: verify
    content: 运行 npm run type-check 与 npm run lint 确认无新增问题
    status: completed
    dependencies:
      - setting-ui
      - exhentai-logic
---

## 用户需求

将 exhentai 设置面板中的“隐藏已下载画廊”开关升级并更名为“仅显示可下载”，并依据真实页面 DOM（`src/site/exhentai/html/ExHentai.org.mhtml`）校准“可下载”判定。

已确认的配套决定（方案 A）：保留 `exhentai.resolveElements()` 的现状实现，并**恢复** exhentai 上“缩略图”开关的显示（该开关现在真实控制瀑布流追加）。

## 真实 DOM 核对结论（来自 `ExHentai.org.mhtml`，25 条列表样本）

### 单条目结构（有种子）

```html
<div class="gl1t">
  <a href="https://exhentai.org/g/4269646/fe5c1ae5c9/"><div class="gl4t glname glink">[Pixiv/fanbox/e621] Dagasi ...</div></a>
  <div class="gl3t" style="height:157px;width:250px"><a href=".../g/4269646/..."><img ...></a></div>
  <div class="gl5t">
    <div><div class="cs ct6">Image Set</div><div id="posted_4269646">2026-10-20 16:01</div></div>
    <div>
      <div class="ir" style="background-position:0px -21px;opacity:1"></div>
      <div>1098 pages</div>
      <div class="gldown"><a href="https://exhentai.org/gallerytorrents.php?gid=4269646&amp;t=fe5c1ae5c9" rel="nofollow"><img src="https://exhentai.org/img/t.png" alt="T" title="Show torrents"></a></div>
    </div>
  </div>
</div>
```

### 无种子条目（同位置只有置灰图标，没有 `<a>`）

```html
<div class="gldown"><img src="https://exhentai.org/img/td.png" alt="T" title="No torrents available"></div>
```

### 统计与推论

- 25 条样本中：16 条 `div.gldown` 内有 `<a href="gallerytorrents.php?...">`，9 条只有 `<img title="No torrents available">`，`div.gldown` 本身 25/25 都存在。
- 不存在 `button`、`disabled` 属性或额外状态 class，因此“下载按钮可点击”⇔ `div.gl5t .gldown a` 命中且带 `href`。
- 现有 `selector.link = 'div.gl5t .gldown a'` 与 `selector.item = 'div.gl1t'`、`selector.container = 'div.itg.gld'` 均与真实 DOM 一致，选择器无需修改。
- 绑定点击后代码会 `removeAttr('href')`，所以“可下载”必须在移除 href 之前判定；本方案所有隐藏判断都在绑定前，天然满足。
- `a:has(.gl4t.glname.glink)` 的 href 形如 `/g/4269646/fe5c1ae5c9/`，与 `extractGidFromGalleryLink()` 的 `/\/g\/(\d+)/` 匹配。

## 产品概述

现有开关仅在归档状态为 200 且无新版本时整条隐藏画廊；本次把开关语义收敛为“只保留能直接点击下载的条目”：200 无新版本、304 过时种子、400 标记跳过、无种子（无下载按钮）四类条目整条隐藏。同时恢复 exhentai 的“缩略图”开关显示。

## 核心功能

- 设置项：exhentai 站点显示“仅显示可下载”开关（原“隐藏已下载画廊”），默认关闭，切换后随“保存并刷新页面”生效。
- 开启后整条隐藏（不占位）：
- 归档 200 且无更新版本；
- 归档 304（只拿到过时种子，原表现是按钮置灰）；
- 归档 400（用户标记跳过下载），此时不再受“跳过已读”控制；
- `$download.length === 0` 或 `href` 为空的条目（`div.gldown` 里只有 `td.png` 置灰图标，无 `<a>`）。
- 304 条目虽被隐藏，仍照旧 `applyArchiveStyle` + 自动入队复查最新种子（后台静默补种，执行器按 `#exhentai_gid_{gid}` 定位，`display:none` 不影响）。
- 关闭开关时行为回到现状：200 仅隐藏下载按钮、304 置灰并复查、400 由“跳过已读”控制、无种子条目保持原样。
- 旧用户已开启原开关的值不丢失。
- “缩略图”开关恢复在 exhentai 显示；其含义为“启用瀑布流追加（自带缩略图）”，关闭后触底不再追加条目。

## 技术栈

Vue 3 + TypeScript + Pinia + Element Plus + jQuery；userscript 由 vite-plugin-monkey 构建；校验用 `npm run type-check`、`npm run lint`。

## 实现思路

### 1. 配置层 `src/store/config-store.ts`

- `SiteConfig.hideDownloadedGallery` 更名为 `onlyShowDownloadable: boolean`，默认 `false`。
- `loadConfig()` 合并前做一次性兼容迁移（仅在旧值存在且新值缺失时继承，并 `delete` 旧键避免脏字段回写）：

```ts
const userSiteConfig = config.sites.get(name) as SiteConfig & { hideDownloadedGallery?: boolean }
if (userSiteConfig.hideDownloadedGallery !== undefined && userSiteConfig.onlyShowDownloadable === undefined) {
  userSiteConfig.onlyShowDownloadable = userSiteConfig.hideDownloadedGallery
}
delete userSiteConfig.hideDownloadedGallery
Object.assign(siteConfig, userSiteConfig)
```

### 2. 设置界面 `src/components/m-setting.vue`

- exhentai 专属表单项：`label` 改“仅显示可下载”，`v-model` 改 `currentConfig.onlyShowDownloadable`。
- `hideDownloadedGalleryChange` 更名为 `onlyShowDownloadableChange`，提示改成“仅显示可下载的画廊 / 显示全部画廊”。
- 删除“缩略图”表单项上的 `v-if="site.siteId !== SiteId.EXHENTAI"`，恢复所有站点显示（`SiteId` 仍被“仅显示可下载”的 `v-if` 使用，导入保留）。

### 3. 生效逻辑 `src/site/exhentai/exhentai.ts`

`attachHandlersForInfos()`（首屏 `mount()` 与瀑布流追加 `onItemsAppended()` 共用，追加页同样生效），读取 `onlyShowDownloadable`，新增局部函数 `hideUnavailableItem($item, gid, title, reason)`（`$item.hide()` + `console.log`）：

- `SkipDownload(400)`：开启 → 整条隐藏；关闭 → 保持 `if (skipRead) $item.hide()`；两种情况都 `continue`。
- `NoNewerSeed(304)`：保留 `applyArchiveStyle($download)` + `queueDownload = true`；开启时额外整条隐藏，但**不 continue**，继续走 `data-orig-href` 绑定与入队。
- `DownloadSuccess(200) && !isNewer`：开启 → 整条隐藏；关闭 → `$download.hide()`；均 `continue`。
- 无下载按钮：判定改为 `$download.length === 0 || !$download.attr('href')`，开启时整条隐藏，否则维持现状（`continue`）。
- 不改判重口径（`resolveArchiveWaterline`）、`ExhentaiDownloadHandler`、队列存储与 `skipRead` 在其他站点的用法。

## 实现要点

- 整条隐藏用 `$item.hide()`，与既有“跳过已读隐藏”“点 × 标记跳过”一致；保留 `id="exhentai_gid_{gid}"` 供队列执行器重定位。
- 幂等：`processedGids` 已防止翻页重叠重复处理；“可下载”判断在 `removeAttr('href')` 之前完成。
- 懒加载计数：`setSisterNumber()` 统计的是全部 `div.gl1t`（含隐藏项），因此隐藏不会让 `lazyLimit` 提前触发更少页；`appendNextLocal()` 判断空页依赖 `resolveElements` 返回的条目数，也不受隐藏影响。
- `resolveElements()` 保持原样（返回条目本身）：瀑布流 `appendNextLocal()` 完全依赖其返回值判空与追加，返回 `[]` 会导致连续 5 页判空后 `isEnd()`。
- `div.itg.gld` 为 CSS Grid，`display:none` 不占位，剩余条目自动补位。
- 仅触及 3 个文件；旧配置通过默认值合并 + 一次性别名迁移兼容。

## 目录结构

```
mansion/
└── src/
    ├── store/
    │   └── config-store.ts        # [MODIFY] onlyShowDownloadable 替换 hideDownloadedGallery + 旧值迁移
    ├── components/
    │   └── m-setting.vue          # [MODIFY] 标签/绑定/提示改为“仅显示可下载”；恢复“缩略图”开关显示
    └── site/exhentai/
        └── exhentai.ts            # [MODIFY] 400/304/200 无新版本/无下载按钮四类条目整条隐藏；304 仍入队复查
```