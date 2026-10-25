# Cloudflare 拦截先识别，onejav 交给浏览器

onejav 的下载链路（详情页解析、`.torrent` 下载）会被 Cloudflare 拦下：挑战页的最终 URL 与原 URL 相同、状态码也可能是 200，旧代码据此判成「拿到直链」或「没有种子」，用户只看到「onejav 也没有可下载种子」这类误导文案。判定集中到 `src/common/cloudflare.ts`：多信号（`cf-mitigated`、`cf-ray` 配 403/503/429、页面特征、最终 URL 落在 `/cdn-cgi/`）任一命中即拦截，响应体只扫前 8KB；404 与 bencode 开头的种子二进制明确不判拦截。

**实测决定了去向**。onejav 用的是 Turnstile：在同一个已经通过验证的浏览器里，页面内 `fetch` 种子链接仍然是 `403 + cf-mitigated: challenge`；只有顶层导航（`Page.navigate`）能在 1~2 秒内过关，最终拿到 `200 application/x-bittorrent`（`file.onejav.com`，该域名同样挂挑战）；FlareSolverr 3.5.2 用无头浏览器 60s 超时；路径里的 hash 也不是文件名的 md5，拼不出免挑战直链。也就是说脚本侧「拿到种子字节」这条路是死的 —— 最初的 FlareSolverr 兜底与 `cf_clearance` 预热已一并删除，理由就是它们只会让用户白等一分钟。

**现在的做法**：识别照旧；命中后把种子地址交给浏览器（`GM_openInTab` → `window.open` → 当前页导航，依次降级），由浏览器自己过验证并下载 `.torrent`。意图层新增 `handoff` 结局，通知写明「miao 自动入库不适用」，且不写归档 —— 文件落在浏览器下载目录，没交给 miao 就不算交付。

**Considered options**：用 `status !== 200` 判拦截（否决 —— 404 与业务失败会被当成拦截，javdb 原实现就白等一次兜底）；靠 `cf_clearance` 带 Cookie 重取（否决 —— 实测仍 403，凭据与浏览器指纹绑定）；构造 iframe / 新标签让用户过验证后由脚本读取文件（否决 —— 挑战页 CSP 是 `default-src 'none'`，页面发不出请求；放行后又是 attachment 直接落盘，脚本读不到字节）；浏览器扩展用 `chrome.debugger` 截响应体（可行，但需要独立 MV3 项目，且每次下载会弹「正在调试此浏览器」，留作后续方案）。
