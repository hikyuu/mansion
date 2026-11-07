# 过盾请求由 miao 代发：页面走 `web.fetch`，字节走 `web.download`

> 部分取代 [0004](0004-miao-web-clearance.md)：过盾仍然交给 miao、仍然只用一次、错误码映射与 fake-ip 的处理都沿用；被取代的是「`clearance` 拿凭证 + 自己重取」这个做法。

**问题**：`GM_xmlhttpRequest` **改不了 `User-Agent`**。脚本管理器把 `User-Agent` 当浏览器保留头丢掉，实际发出去的是浏览器自己的 UA；而 `cf_clearance` 绑定过盾浏览器的 UA —— 带别人的凭证、用自己的 UA 发请求，等于重新触发挑战。实测印证：miao 侧 `clearance` 成功（27s、`solved: true`）、`web.fetch` 详情页 200（热路径 845ms）并解析出种子链接，但同一份 `cookie` + 过盾 UA 交给 Node/undici 重取，仍 403「Just a moment...」。

**更根本的一层**：onejav 对「页面内 XHR」的请求一律下挑战（0002 的实测：同一浏览器、已验证、页面内 `fetch` 种子链接仍 403 + `cf-mitigated: challenge`；只有顶层导航能过）。GM 请求正是 XHR 语义，所以**无论 UA 怎么对齐，浏览器栈都拿不到 onejav 的种子字节**。

**结论**：请求不能由浏览器发。miao 是同一台机器上的原生进程，它发请求既不受 GM 的保留头限制，也可以按需过一次盾后用自己的 UA 走纯 HTTP。于是通道从「要凭证」改成「代发请求」，两个动词各管一类响应：

| 需求 | 动词 | 为什么 |
| --- | --- | --- |
| 页面 HTML（详情页解析） | `web.fetch` | 过盾用真浏览器（Turnstile 也能过），且返回的是渲染后的文本，正是要解析的东西 |
| 种子/压缩包等二进制 | `web.download`（miao 0.6.0 新增） | 浏览器只能打开页面，`request.get` 只回文本；文件字节必须由服务端纯 HTTP 取，所以它不带 FlareSolverr 冷路径，凭证失效即失败并作废该凭证 |

**mansion 侧的形状**：`src/common/miao-proxy.ts` 只定义两个通道（`PageFetchProvider` / `BinaryFetchProvider`，约定不抛错，`tryProxy` 兜住实现方炸掉的情况），实现在 `src/download/miao-proxy.ts`（错误码 → 一句可读原因；挑战没过就销毁该站点会话，不再记失败记忆）。调用点两处：

- `fetchPageThroughCloudflare`：GM 取页面 → 命中拦截 → 整页交给 `pageFetch` → 对返回的 HTML 再判一次拦截（服务端也可能被拒）；
- `fetchTorrentBase64`：先试 `proxy`（miao 代下载）→ 失败回落 GM → GM 也被拦才抛 `CloudflareBlockedError`。回落这一层不是给某个站点写特判，而是兜住「miao 拿不到」的所有情况（没配白名单、没有站点登录态）。

`miao.ts` 一律传 `miaoBinaryFetch`：不再按站点判断该不该过盾，站点差异交给 miao 的白名单。

**连带删除**：`src/common/clearance.ts`、`src/download/miao-clearance.ts`（凭证型通道）、`common.ts` 的 `userAgent` 选项（GM 改了也没用，留着只会误导）、`torrent.ts` / `cloudflare-guard.ts` 里的 cookie + UA 重取逻辑。

**纯 HTTP 也过不去时：接管过盾器的下载器**

`web.download` 的纯 HTTP 路径在 onejav 上仍然失败：`file.*` 子域对**任何非导航请求**都下 Turnstile，Node 带 miao 的凭证、`text/html` 与 `*/*` 两种 Accept 实测都是 `403 + Just a moment...`——`cf_clearance` 只解决「人机校验」这一层，规则层按请求形态重新下挑战，凭证救不了。

先加一层接口上的区分：`download` 接受 `mode: auto | http | browser`（缺省 `auto`）。调用方本来就知道目标站点要不要浏览器栈（onejav 的 `file.*` 必须），让它猜等于每次白跑一次必然失败的纯 HTTP 请求，耗时也给不出预期；`http` 用于「快速失败、绝不拉浏览器」，`browser` 用于直接走下载栈，`auto` 留给未知站点。

绕过它的唯一形态是**浏览器顶层导航 + 浏览器下载栈**。miao 侧新增 `SolverBrowserDownloader`：

1. 从进程命令行找**过盾器启动的 chrome**（只认父进程是 `flaresolverr.exe` 的那个，避免误接管用户自己的浏览器），取 `--remote-debugging-port`；
2. 连 browser 级 CDP：`Browser.setDownloadBehavior { behavior: 'allowAndName' }` → 文件按 `guid` 命名落盘（`allow` 会用站点文件名，重名被改成 `(1)`，只能靠猜）；
3. `Target.createTarget` 顶层导航到目标 URL（挑战由这个 undetected 浏览器自己过）；
4. 用 `Browser.downloadProgress` 事件判定完成（`inProgress` → `completed` / `canceled`），不再轮询目录「大小稳定」；
5. 读 `<临时目录>/<guid>` → 关 target → 删临时目录；超限抛 `WEB_RESPONSE_TOO_LARGE`。

自己另起 Chromium 用 CDP 控是走不通的：实测 headful Edge + 反检测能过 onejav 的 managed challenge，但到 `file` 子域的 Turnstile 小部件就卡死（90s 未通过）。所以必须复用 FlareSolverr 那个浏览器。

**实测（onejav，2026-11-06）**：`web.fetch` 详情页 → `web.download`（纯 HTTP 403 → 降级浏览器）→ `browser: true`、`27126` 字节、首字节 `0x64`、`elapsedMs` 约 7.7s。

**遗留**：`@hikyuu/miao` 0.6.1（只多了 `WebDownloadResult.browser` 字段）因本地 PAT 缺 `write:packages` 未发布，mansion 仍用 0.6.0（多余字段被忽略，不影响功能）。`SessionPool` / `flare-solverr.ts` 仍在（javdb 详情页用它，未迁）。

**后续修订 · 挑战没过就销毁会话，去掉快失败**：原实现把「贵的失败」按 origin + 能力（页面 / 字节）记 5 分钟，期间同一站点直接判失败，设置面板的「连接测试」负责清除记忆。现在挑战没过（`CHALLENGE_FAILED` / `CHALLENGE_TIMEOUT`）或 `web.fetch` 回来的 HTML 仍是挑战页时，调 `MiaoClient.web.invalidate(origin)`（SDK 0.7.0 的 `DELETE /api/v1/web/clearance?origin=`，仓库侧唯一能销毁 miao 会话的接口）作废该站点凭证：下次请求不会再命中这份没过挑战的缓存，而是重新过盾。既然一次失败不再意味着「一段时间内不值得再试」，失败记忆、TTL 与设置面板的清除入口一并删除，遗留的 `miaoClearance` 通道同样不再记 hopeless。销毁是 fire-and-forget，失败只记日志、不改本次的失败原因；配置类错误（白名单 / token / web 未启用）与连不上 miao 不销毁。单次下载意图仍然只过一次盾、被拦后照旧换 javdb 磁力。

**后续修订 · onejav 独占 auto 代下载**：`fetchTorrentBase64` 增加 `proxyOnly`，`resolveSeedSource` 对 `PROXY_DOWNLOAD_SITES`（当前只有 onejav）传 `proxyOnly: true`：种子字节只由 `web.download({ mode: 'auto' })` 取，失败不再回落 GM，直接抛 `CloudflareBlockedError` 让意图层改投已挂好的 javdb 磁力。理由：GM 请求在这类站点必被拦，回落只是白等一个 30s 超时，还会把 miao 的失败原因（白名单 / 过盾器 / token）盖成「站点拦截」。exhentai 等非白名单站点仍保留「代下载失败 → GM 直取」的回落。下载模式用 `auto`（取代正文「`auto` 留给未知站点」的判断）：由服务端先试纯 HTTP、撞挑战再降级浏览器下载栈，实际走哪条由 `WebDownloadResult.mode` 回报；正文 :41 的实测就是这条路径。
