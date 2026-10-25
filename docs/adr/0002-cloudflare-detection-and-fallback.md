# Cloudflare 拦截先识别再兜底，种子二进制靠 cf_clearance 重取

onejav 的下载链路（详情页解析、`.torrent` 下载）会被 Cloudflare 拦下：挑战页的最终 URL 与原 URL 相同、状态码也可能是 200，旧代码据此判定为「拿到直链」或「没有种子」，用户只看到含糊提示。现在判定集中到 `src/common/cloudflare.ts`：多信号（`cf-mitigated`、`cf-ray` 配 403/503/429、页面特征、最终 URL 落在 `/cdn-cgi/`）任一命中即拦截，响应体只扫前 8KB；404 与 bencode 开头的种子二进制明确不判拦截。命中后 `src/common/cloudflare-guard.ts` 切 FlareSolverr 会话池重取，并在本会话内对该站点固定走兜底。

FlareSolverr 的 `request.get` 只返回文本，无法代下 `.torrent`，所以种子链路只能「先过挑战换 `cf_clearance`，再让 GM 请求带 Cookie 重取一次」；凭据只存内存（20 分钟上限）、不进 GM 存储、不落日志。cf_clearance 与 UA/IP 绑定，无头浏览器 UA 与当前浏览器不一致时重取仍会失败 —— 此时报「请在浏览器打开站点通过验证后重试」，不静默重试。

**Considered options**：用 `status !== 200` 判拦截（否决 —— 404 与业务失败会被当成拦截，javdb 原实现就这样白等一次兜底）；让 FlareSolverr 直传种子二进制（否决 —— 该接口只回文本，`rawResponse` 也不保证原样）；把识别塞进 `request()`（否决 —— 它是通用 GET 封装，改动会波及瀑布流等无关链路）。
