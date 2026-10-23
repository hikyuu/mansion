---
name: 接入 miao SDK 作为优先默认下载方式
overview: 在 mansion 油猴脚本中接入 @miao/thunder-client（miao 本地 REST 服务），作为优先默认下载方式：miao REST 建任务，失败或 URL 不支持时自动回退迅雷协议；设置面板新增下载方式/savePath/baseUrl/连接测试；needsSelection 弹窗勾选重试；用 vitest 覆盖边界条件，并产出 SDK 完善思路文档。
todos:
  - id: config-migration
    content: 改造 config-store：downloadMethod 字符串化迁移默认 miao，新增 common.miao 配置
    status: completed
  - id: transport-picker
    content: 实现 gm-fetch 适配器与 file-picker 勾选服务及弹窗组件
    status: completed
    dependencies:
      - config-migration
  - id: miao-channel
    content: 实现 miao.ts：URL 分类、addVideoTask 编排、needsSelection 重试、错误映射回退迅雷
    status: completed
    dependencies:
      - transport-picker
  - id: dispatch-archive
    content: 改造 download/index.ts 分发与 exhentai 归档按结果写入
    status: completed
    dependencies:
      - miao-channel
  - id: settings-ui
    content: 设置面板加下载方式三选一、savePath、baseUrl、连接测试按钮
    status: completed
    dependencies:
      - config-migration
      - miao-channel
  - id: vitest-cases
    content: 新建 vitest.config.ts 并编写边界用例，npm run test 通过
    status: completed
    dependencies:
      - dispatch-archive
  - id: sdk-doc
    content: 撰写 docs/miao-sdk-improvements.md SDK 完善思路文档
    status: completed
    dependencies:
      - vitest-cases
---

## User Requirements

- 接入 miao SDK（@miao/thunder-client），并在设置中设为优先默认下载方式
- 降级策略（全员默认，含存量用户）：miao REST 建任务；miao 不可用（未安装/未开 REST/白名单未配/报错）或 URL 类型不支持时自动回退迅雷协议；不回退复制链接；设置里提供「miao 优先 / 迅雷协议 / 复制链接」三选一可改
- **任务类型按站点映射（用户指定）**：exhentai → `addGalleryTask`（画廊任务）；javdb / javstore / onejav → `addVideoTask`（视频任务）。**远程 .torrent 文件 URL 本次不做客户端转换（用户确认）**：miao 只接受本地种子路径或磁链，种子链接直接回退迅雷；「远程种子 URL / 字节上传」列为 SDK 完善文档 **P0**，待 miao 支持后 gallery 路径才真正触发（本次映射代码就位）。磁链按上述站点映射调用任务接口
- 设置面板新增：下载方式三选一、下载目录 savePath、服务地址 baseUrl、连接测试按钮；不做 token 输入（若 miao 侧配 token 导致 401 需明确提示）
- needsSelection（多候选文件）时弹窗列文件清单（index/路径/大小）勾选后带 files 重试
- 用 vitest 单元测试验证各种边界条件（连不上、401、403、502、504、needsSelection、URL 分发、站点→任务类型映射等）
- SDK 完善思路落盘为 mansion/docs/ 下的文档

## Product Overview

mansion 油猴脚本下载模块升级：接入 miao 本地 REST 服务（迅雷任务管理）作为优先下载通道，按 URL 类型与服务可用性自动编排 miao 与迅雷协议，并按站点选择 miao 任务类型（exhentai 画廊 / 其余视频），配套设置界面、连接自检、文件勾选交互，并以单元测试锁住边界行为。

## Core Features

- 下载分发：miao 优先（默认）/迅雷/复制；磁链按站点建任务（exhentai→addGalleryTask、其他→addVideoTask），远程种子 URL 与直链自动回退迅雷
- 自动回退：miao 失败时回退迅雷并在通知中说明原因
- needsSelection 文件勾选弹窗，确认后重试建任务
- 设置项：下载方式、savePath、baseUrl、连接测试（显示 miao 未运行/迅雷未连接/非 Windows 等状态）
- 存量配置迁移：downloadMethod 统一升级为 miao 优先
- vitest 边界用例与 SDK 完善思路文档（远程种子 URL/字节上传列 P0）

## Tech Stack Selection

- 沿用现有栈：Vue 3 + TypeScript + Pinia + Element Plus + vite-plugin-monkey（GM_xmlhttpRequest/GM_getValue）
- 下载 SDK：`@miao/thunder-client`（已声明 `file:../flutter/miao/sdk/ts`，vite/tsconfig 已配别名，src/ 尚未使用，本次接入）
- 测试：vitest（package.json 已有 `"test": "vitest"`，`src/__tests__/` 为空）

## Implementation Approach

在 `src/download/` 下新增 miao 通道模块，统一由 `download(url)` 编排：URL 分类（magnet 可走 miao；http/https 远程种子与直链不支持）→ 按站点选任务类型（exhentai→addGalleryTask、其余→addVideoTask）→ miao REST 建任务 → 失败或不支持按原因自动回退 `thunderDownload`。由于 miao REST 不返回 CORS 头，页面环境必须用 GM_xmlhttpRequest 适配成 fetch 形状注入 `ThunderClient` 的 `options.fetch`。`addVideoTask` 自动挑 >100MB 视频，比 createFromMagnet 全量更符合视频站点；`addGalleryTask` 承载 exhentai 画廊语义（单压缩直下/多压缩 needsSelection/否则动态图片）；needsSelection 用全局弹窗组件（Pinia store + Promise 服务）勾选后带 `files` 重试。

关键决策：

- **站点→任务类型映射**：`SiteId.EXHENTAI` → `addGalleryTask`；javdb、javstore、onejav → `addVideoTask`。抽成纯函数 `pickTaskKind(siteId)` 便于测试；站点识别用 `useSiteStore().getSite.siteId`。
- **远程种子 URL 不做客户端转换**（用户确认）：不做 bencode 解析转磁链，.torrent 链接直接回退迅雷；SDK 文档将「远程种子 URL / 种子字节上传」列为 P0，miao 支持后 exhentai 的 gallery 路径才真正触发（映射代码本次就位，激活时无需改结构）。
- **downloadMethod 数字改字符串** `'miao'|'thunder'|'copy'`：旧值为 number（0 迅雷/1 复制）且从未有 UI，loadConfig 时凡非字符串一律迁移为 `'miao'`（满足「全员默认含老用户」）；此后 UI 只写字符串，不会再被迁移覆盖，无需版本号方案。
- **common.miao = { savePath, baseUrl }** 作用域为全局（与站点无关），loadConfig 对缺字段补默认值。
- **download(url) 改为返回 Promise&lt;DownloadSubmitResult&gt;**：内部永不 reject；exhentai 归档改按结果写 DownloadSuccess（消除误标边界）；其余调用点保持 fire-and-forget 不动，控制爆炸半径。
- **message 结局也回退迅雷**：miao 成功响应但「无可下载目标」（如无 >100MB 视频、gallery 无动态图片）时，仍回退迅雷整链下载并提示原因，保证下载意图不落空。
- 测试抽纯逻辑（URL 分类、任务类型映射、回退决策、错误→文案映射、重试参数构造），GM/Element Plus/Pinia 用 mock。

性能与可靠性：magnet 建任务为一次 REST 往返（服务端磁链两段式最长 60s 元数据等待，SDK 超时默认 15s，可按 timeoutMs 调整为 30s）；回退为同步 thunderLink 调用，无额外开销；弹窗 Promise 挂起不阻塞队列其余条目。

## Implementation Notes

- **CORS/GM 适配器**：`gmFetch` 只需实现 SDK 实际用到的面（method/headers/body/signal；响应 ok/status/text()）；abort 时 reject 且 `error.name === 'AbortError'`，否则 SDK 超时文案失真。`vite.config.ts` 的 `connect: ['*']` 已满足 127.0.0.1 访问。
- **配置迁移**：`loadConfig` 中 `Object.assign(siteConfig, userSiteConfig)` 前先做 `typeof downloadMethod !== 'string'` 判定；`common.miao` 缺失时 `Object.assign` 默认值；`$subscribe → saveConfig` 已有，设置改动即持久化。
- **回退通知**：统一 ElNotification warning「已回退迅雷：{原因}」；401 文案指向「miao 侧清空 token」；403 指向「savePath 未命中白名单/白名单未配（fail-closed）」。
- **连接测试**：health() 分类提示：连不上→miao 未运行/未开 REST；401→token 提示；thunderSupported=false→非 Windows；thunderConnected=false→迅雷未启动；正常→显示 apiVersion。白名单 health() 探测不到，文案提示需在 miao 侧配置。
- **归档边界**：`exhentai-download-handler.ts` 的 `handleLatestTorrent`/`downloadAndArchive` 改 `await download()`，`ok` 才写 DownloadSuccess；`DownloadOutcome.downloaded` 语义更新为真实提交结果。javdb/javstore/onejav 调用点不动。
- **测试配置**：新建 `vitest.config.ts`（勿让 vitest 加载 vite.config.ts 的 monkey 插件），仅保留 `@` 与 `@miao/thunder-client` 别名 + test 配置；element-plus、vite-plugin-monkey/dist/client、pinia store 按需 `vi.mock`。

## Architecture Design

分层：站点调用方 → `download()` 编排层 → 通道实现（miao/thunder/copy）→ 传输适配（gmFetch）+ 交互服务（file-picker）。数据流：站点触发 download(url) → URL 分类 → 按站点选任务类型 → addGalleryTask/addVideoTask → created/needsSelection（弹窗→重试）/message 或错误 → 回退 thunderLink → DownloadSubmitResult 反馈（exhentai 据此归档）。

```mermaid
flowchart LR
  A[站点调用 download(url)] --> B{downloadMethod}
  B -->|miao 优先| C[URL 分类]
  C -->|magnet| D[按站点选任务<br/>exhentai→addGalleryTask<br/>其他→addVideoTask]
  C -->|http/https 种子/直链| F[回退迅雷<br/>种子直投待 SDK P0]
  D -->|created| G[成功通知]
  D -->|needsSelection| H[文件勾选弹窗<br/>带 files 重试]
  D -->|message/错误| F
  F --> I[thunderLink.newTask]
  B -->|迅雷| I
  B -->|复制| J[copyUrl]
  G & H & I & J --> K[DownloadSubmitResult]
  K --> L[exhentai 按结果归档]
```

## Directory Structure

```
mansion/
├── src/
│   ├── download/
│   │   ├── index.ts            # [MODIFY] 分发入口。downloadMethod 三值分发；改返回 Promise<DownloadSubmitResult>，内部捕获全部异常
│   │   ├── miao.ts             # [NEW] miao 通道。URL 分类 classifyDownloadUrl、站点→任务类型映射 pickTaskKind（exhentai→gallery/其他→video）、构建 ThunderClient（gmFetch 注入）、addGalleryTask/addVideoTask 编排、needsSelection 重试、错误→回退原因映射、miaoHealth() 供连接测试
│   │   ├── gm-fetch.ts         # [NEW] GM_xmlhttpRequest→fetch 适配器。实现 method/headers/body/signal、AbortError 语义、Response 最小面（ok/status/text()）
│   │   ├── file-picker.ts      # [NEW] needsSelection 勾选服务。Pinia store 挂起 Promise；requestFileSelection(files)→Promise<number[]|null>；构造重试 files 参数
│   │   ├── thunder.ts          # [保留] 迅雷协议回退通道
│   │   └── clipboard.ts        # [保留] 复制通道
│   ├── components/
│   │   ├── ms-miao-file-picker.vue  # [NEW] 文件勾选弹窗。el-dialog+el-table 多选（index/路径/格式化大小），确认返回勾选 index，取消返回 null
│   │   └── m-setting.vue       # [MODIFY] 设置面板。新增下载方式 radio（miao 优先/迅雷/复制）、savePath、baseUrl（仅 miao 时显示）、连接测试按钮+结果提示
│   ├── components/m-home-site.vue   # [MODIFY] 挂载 ms-miao-file-picker（与 ms-download-queue 并列，全站生效）
│   ├── store/config-store.ts   # [MODIFY] downloadMethod 改字符串联合类型、默认 'miao'；loadConfig 迁移数字旧值；Config.common.miao={savePath,baseUrl} 默认合并
│   ├── site/exhentai/exhentai-download-handler.ts  # [MODIFY] await download 结果，ok 才归档 DownloadSuccess；更新 DownloadOutcome 注释
│   └── __tests__/
│       ├── download-url.test.ts      # [NEW] URL 分类边界：magnet 大小写、远程种子、直链、空串；站点→任务类型映射（exhentai→gallery、其他→video）
│       ├── miao-download.test.ts     # [NEW] 回退链：连不上/401/403/502/504/message/savePath 空/created/needsSelection 重试/按站点调 gallery 或 video/thunder/copy 分发
│       ├── config-migration.test.ts  # [NEW] 数字→'miao' 迁移、字符串保留、common.miao 默认合并
│       └── gm-fetch.test.ts          # [NEW] ok/status/text、abort→AbortError、网络错 reject
├── vitest.config.ts            # [NEW] 测试入口。别名（@、@miao/thunder-client）+ test 配置，不加载 monkey 插件
└── docs/
    └── miao-sdk-improvements.md # [NEW] SDK 完善思路文档（远程种子 URL/字节上传列 P0）
```

## Key Code Structures

```ts
// src/download/index.ts —— 编排结果契约
export type DownloadMethod = 'miao' | 'thunder' | 'copy'
export interface DownloadSubmitResult {
  ok: boolean
  channel: 'miao' | 'thunder' | 'copy'
  fellBack: boolean
  message: string
}
export function download(url: string): Promise<DownloadSubmitResult>
```

```ts
// src/download/miao.ts —— 站点→任务类型映射
export type MiaoTaskKind = 'gallery' | 'video'
// EXHENTAI → 'gallery'，javdb/javstore/onejav → 'video'
export function pickTaskKind(siteId: SiteId): MiaoTaskKind
```

```ts
// src/download/gm-fetch.ts —— 适配器契约（满足 ThunderClient options.fetch）
export const gmFetch: typeof globalThis.fetch
// 响应最小面：{ ok: boolean; status: number; text(): Promise<string> }
// abort 时 reject 且 error.name === 'AbortError'
```

## SDK 完善思路文档要点（docs/miao-sdk-improvements.md）

- **P0：远程 .torrent URL / 种子字节上传支持**（服务端拉取远程种子，或 `POST /api/v1/thunder/tasks/torrent` 接受 bytes/base64 body）——打通 exhentai/onejav 种子链接直投 gallery/video 任务，是本项目 gallery 路径真正触发的前提（用户指定优先级最高）
- 通用 HTTP/FTP 直链任务接口（onejav file.onejav.com 直链）
- 浏览器/CORS 官方支持（Access-Control-Allow-Origin 白名单或官方 GM fetch 适配示例）
- GET 配置接口（默认 savePath/白名单列表，免手填）；token 浏览器接入方案
- health 扩展白名单未配探测
- 任务列表/进度与 infoHash 幂等去重
- needsSelection 预览与深链接 files 编码一致性
- 错误码细化（白名单未配 vs 路径非法）
- 速率限制与 deleteFile 开关；非 Windows 优雅降级
- 深链接通道（openMiao）作为 REST 外补充