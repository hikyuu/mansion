# 过盾交给 miao 的 web 能力，SDK 换用 MiaoClient 命名空间

> **「拿凭证自己重取」已由 [0005](0005-miao-proxies-requests.md) 取代**：`GM_xmlhttpRequest` 改不了 UA，凭证必然不匹配；请求改由 miao 代发（`web.fetch` / `web.download`）。「过盾交给 miao、只用一次、错误码映射、fake-ip 处理」仍然有效。

SDK 已从 `@hikyuu/thunder-client` 更名为 `@hikyuu/miao`（0.5.0，API 不变，包内仍导出 `ThunderApiError` / `ThunderTransportError` 与兼容的 `ThunderClient`）。`MiaoClient` 在 `ThunderClient` 之上挂了 `web` 能力（`clearance` / `fetch` / `invalidate` / `sessions`，对应 miao 的 `/api/v1/web/**`，服务端 `apiVersion ≥ 3`），健康检查带了 `webSupported` / `webHostWhitelistReady` / `solverReachable` / `cookieExportAllowed`，错误码带 `WEB_*` / `SOLVER_*` / `CHALLENGE_*` 并给了 `isHostRejected` / `isSolverUnavailable` / `isRetryable` / `isChallengeFailed` / `retryAfterMs`。本项目因此把两件事一起做掉：依赖换成 `@hikyuu/miao@0.5.0` 并改用 `MiaoClient` 命名空间；过盾（过 Cloudflare）从「自己连 FlareSolverr 管会话」改为「向 miao 要凭证」。

**为什么换**：本仓库原来直连 `http://127.0.0.1:8191/v1`，自己维护会话池、500 重试、cookie 合并、按站点传 `cookieDomain`。这些都不是本站点该操心的事 —— 过盾器的安装、启停、版本升级与站点白名单，miao 的「过盾」页已经管了，而且它按 origin 缓存凭证。脚本侧只该做一件事：**要一张凭证，带上它重取一次**。

**现在的做法**：`src/common/clearance.ts` 只定义通道形状 —— `ClearanceProvider = (url) => Promise<ClearanceResult>`，约定**不抛错**（`tryClearance` 兜住实现方炸掉的情况），凭证是 `{ cookie, userAgent }` 一对。唯一实现在 `src/download/miao-clearance.ts`：按配置里的 `baseUrl` 建 `MiaoClient`，调 `web.clearance(origin)`，失败按错误码翻成一句可读原因（`CHALLENGE_FAILED` → 「过盾失败（拿回的仍是挑战页）」、`SOLVER_UNAVAILABLE` → 「过盾器未启动或地址不可达」等）。调用方两处，都只试一次：

- `fetchTorrentBase64`（种子字节）：命中拦截 → 要凭证 → 带 `cookie` 与 `User-Agent` 重取一次；
- `fetchPageThroughCloudflare`（页面）：命中拦截 → 要凭证 → 带 `cookie` 与 `User-Agent` 重取一次。

**cookie 与 UA 必须成对**：`cf_clearance` 绑定 UA，只带 cookie 用自己的 UA 会立刻重新触发挑战，所以 `navigationHeaders` 之外还要覆盖 `User-Agent`（`GM_xmlhttpRequest` 的 `cookie` 字段是**补进**浏览器自带 Cookie，不是替换，站点登录态因此不受影响）。

**Turnstile 也试**：0002/0003 里「Turnstile 一次都不试」的前提是「无头 FlareSolverr 白等 60s 也过不去」。过盾器现在由 miao 托管，跑的是真浏览器内核，前提不再成立 —— 跳过等于让 onejav 这条链路永远用不上过盾。代价是失败时多等一个过盾周期（服务端 120s，SDK 侧 150s），用「本次会话已尝试过且未通过」的 memo 收敛：同一个 origin 失败一次后不再重复等待，换 miao 地址（换实例）即作废，配置类错误（白名单 / token / web 未启用）不记 memo，改完就能立刻重试。

> 后续：这条 memo 已随「挑战失败后销毁会话、去掉快失败」一并移除，见 [0005](0005-miao-proxies-requests.md) 的后续修订。

**站点白名单在 miao 侧**：本地不再维护 `FlareClearanceTarget` 那套「站点 → session + cookieDomain」坐标，`miaoDownload` 无条件把通道交给种子下载。miao 侧白名单为空时全部拒绝（fail-closed），所以「没配白名单」会退化成一次快速的 REST 拒绝，而不是静默放行。

**健康检查分层**：建任务通不代表过盾可用 —— 两者在 miao 里是独立开关。`miaoHealth` 保留原有建任务判定，另加一段过盾就绪度（web 能力 → 站点白名单 → 过盾器可达 → 允许导出凭证）；过盾缺件时 `ok` 仍为 `true`（建任务确实能用），`type` 降为 `warning` 并说明「被拦的站点会直接失败」。老版本 miao 不返回 web 字段时按「版本过低」处理，不按 `false` 报错。

**Considered options**：继续直连 FlareSolverr 只管种子字节（否决 —— 两套过盾并存，会话与凭证各管一份，排查时说不清是谁没过）；页面链路改用 `web.fetch` 由 miao 代取（否决 —— miao 侧是独立进程的裸 HTTP，拿不到浏览器登录态，javdb 这类需要登录的页面直接失效；且响应是 HTML 文本，种子字节取不了）；把凭证写进浏览器 cookie jar（否决 —— `cf_clearance` 是 `HttpOnly`，页面脚本写不进去）；javdb 详情页顺带一起迁（延后 —— 它现在有「一旦命中就整个会话切过去 + 轮换会话重试」的旁路模式，登录态相关，单独一片做）。

**连带删除**：`torrent.ts` 里的 `clearThroughFlare`、`FlareClearanceTarget` 选项与 `CLOUDFLARE_PROBE_CHARS` 相关的 cookie 合并逻辑；`cloudflare-guard.ts` 里的 `fetchPageThroughFlare`；`cloudflare.ts` 的 `describeFlareAttempt`（改为 `describeClearanceFailure`）与 `isTurnstileBlock`（「跳过 Turnstile」的规则没了，函数成了死代码）。`SessionPool` / `flare-solverr.ts` 暂时保留：javdb 详情页还在用。

**实测（onejav，2026-11-06）**：

- `web.clearance('https://onejav.com')` → 首次 27s、`solved: true`，拿到 `cf_clearance`（会话 cookie，`expiresAt: null`）；
- `web.fetch(详情页)` → 200，`cached: true`（走纯 HTTP 热路径，845ms）并解析出种子链接 —— miao 侧链路完整可用；
- 用同一份 `cookie` + 过盾 UA 走 Node（undici）重取 → 仍 403「Just a moment...」。**凭证只在浏览器栈有效**：`cf_clearance` 绑定 UA 与 TLS/HTTP2 指纹，Node 复现不了，所以过盾只能在 `GM_xmlhttprequest` 那条路上验证，Node 侧不能代测；
- 子域 `file.onejav.com` 被裸域名 `onejav.com` 覆盖（白名单匹配通过），但它会**单独过一次盾**（22s），拿回的 cookie 仍是 `cf_clearance@onejav.com` —— 父子域共享，值一次也够用；
- 本机解析被 Clash fake-ip 接管（`198.18.0.0/15`）时曾整条链路报 `WEB_URL_INVALID`，miao 侧已加「信任代理 fake-ip」开关（只放行该段，其余私网段照拒）。
