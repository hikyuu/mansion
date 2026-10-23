# @miao/thunder-client SDK 完善思路

> 来源：mansion 油猴脚本（javdb / javstore / onejav / exhentai）接入 miao REST 服务的实践反馈。
> 接入实现见 mansion `src/download/`（miao.ts / gm-fetch.ts / torrent.ts / file-picker.ts），
> 接口规格见 [`miao/docs/thunder-rest-api.md`](../../flutter/miao/docs/thunder-rest-api.md)。
>
> 本文档随 SDK 更新同步：✅ = 新版 SDK 已落地，⏳ = 仍建议跟进。

## 接入现状摘要

mansion 把 miao 设为**优先默认下载方式**：磁链与远程种子链接都直投 miao
（exhentai → `addGalleryTask`，javdb/javstore/onejav → `addVideoTask`），
失败时自动回退迅雷协议；needsSelection 弹窗勾选后带 `files` 重试。

浏览器侧的两个关键约定：

1. **传输走 GM_xmlhttpRequest**（mansion `gm-fetch.ts`）：REST 的 `Origin` 白名单是
   fail-closed 的，普通网页 fetch 必须先在 miao 侧配置来源；油猴特权通道不带 `Origin`，
   两条规则都不受影响，因此 mansion 无需用户配置 CORS。
2. **远程种子先下载再上传**（mansion `torrent.ts`）：站点种子链接需要登录 Cookie，
   由浏览器带 Cookie 拉取后编码为 `torrentBase64`（≤5MiB、bencode 首字节校验），
   免种子目录白名单。

## ✅ 已落地（本次 SDK 更新）

| 能力 | 对应实现 | 对 mansion 的影响 |
| --- | --- | --- |
| **远程种子直投（P0）** | `torrentBase64`（5MiB 上限 + bencode 校验 + 临时落盘即删） | exhentai gallery 任务路径**已真正启用**；onejav 种子走视频任务；迅雷仅剩直链兜底 |
| **`savePath` 可选** | 缺省用服务端「默认下载目录」，`GET /config` 可查 | 设置项可留空；mansion 只在非空时传 `savePath` |
| **`GET /api/v1/config`** | 返回 `defaultSavePath` / `savePaths` / `seedPaths` | 连接测试可展示默认目录；后续可做合法目录下拉 |
| **health 扩展** | `savePathWhitelistReady` / `seedPathWhitelistReady` / `authRequired`（health 免鉴权） | 连接测试能一次体检全部前置条件，不再靠建任务撞错 |
| **分接口默认超时** | 建任务 90s / 查询 15s / health 5s，支持单次覆盖 | mansion 删除了本地 90s/5s 常量，避免与 SDK 漂移 |
| **幂等与任务查询** | `duplicate` 字段（infoHash+savePath 去重）、`listTasks` / `findByInfoHash` | 连按 Enter 不再建双任务；通知里提示「任务已存在」 |
| **错误码细化** | `SAVE_PATH_WHITELIST_EMPTY` vs `SAVE_PATH_NOT_ALLOWED`、`METADATA_TIMEOUT` vs `PERSIST_TIMEOUT`、`ORIGIN_NOT_ALLOWED`、`reason` 字段 | 回退原因文案可直接区分「去配置白名单」与「换路径」 |
| **`cancelMagnetTemp`** | 删除磁链两段式的临时任务 | needsSelection 超时/取消后可清理残留后台任务 |
| **`openMiaoWithConfirm`** | 深链接拉起 + REST 轮询确认 | 后续可做「REST 未开启时拉起应用」的混合模式 |
| **安全加固** | Origin 白名单 fail-closed、token 走 DPAPI + 恒定时间比较、health 免鉴权只回布尔位 | mansion 无需 token 配置，健康检查可直接用 |

## ⏳ 仍建议跟进

### P1：异步建任务（消除 90s 同步阻塞）

磁链两段式与视频/画廊规则解析仍然是同步 POST：最长 90s 才返回 `created` /
`needsSelection` / `message`。浏览器侧表现为「按键后长时间无反馈」，needsSelection
交互也因此被迫阻塞在同一次调用里。

建议：`POST ?async=true` 返回 `jobId`，`GET /jobs/:id` 轮询或 WebSocket 推送三结局；
mansion 可据此先提示「已提交，正在解析元数据」，解析完再弹文件勾选。

### P2：任务列表/进度与 mansion 的联动

`listTasks` 已可用，但 mansion 目前只提示「已添加任务」。可考虑：

- 用 `findByInfoHash` 做建任务前的轻量预检（服务端幂等已覆盖，仅用于更好的提示）；
- 在通知/面板里展示 `status` / `receivedSize`（需轮询，注意频率）。

### P2：深链接与 REST 的能力对齐

`openMiao('task/add')` 的 `files` 仍是逗号分隔（文件名含逗号有歧义），且无回执。
建议统一为 REST 的 index 语义，或直接推荐 `openMiaoWithConfirm` 混合模式。

### P3：运维与安全收尾

- **速率限制**：本机进程仍可循环建任务灌满迅雷任务库，建议按 token/来源限流。
- **`deleteFile=true`**：现状默认不删，但没有总开关；如需暴露给远程调用方建议加开关。
- **WebSocket 服务（0.0.0.0:6426，无鉴权）**：比 REST 风险更高，建议另行收紧。
- **非 Windows**：已通过 `UNSUPPORTED` + health 明示，可考虑直接不暴露建任务路由。

## 附：mansion 侧与 SDK 的约定（随 SDK 更新）

| 约定 | 原因 |
| --- | --- |
| 不覆盖 SDK 超时（用分接口默认值） | 建任务 90s 已覆盖服务端 60s 元数据 + 15s 入库，防止「客户端放弃 + 服务端仍建成」双份任务 |
| 建任务前先校验种子首字节 `d` | 登录页/失效页返回 HTML，提前失败给出可读原因，而不是等服务端 400 |
| `savePath` 非空才传 | 留空走服务端默认下载目录，避免把空串当路径 |
| message 结局整链回退迅雷 | 无 >100MB 视频/无动态图片时下载意图不落空 |
| needsSelection 取消不回退 | 用户主动取消 ≠ 失败，避免误投整链 |
| 空 `baseUrl` 回退 SDK 默认值 | 防止拼出相对 URL 打到当前页面 |
| gmFetch 的 abort 用 `error.name='AbortError'` | 保 SDK 超时/中止归因不失真 |
