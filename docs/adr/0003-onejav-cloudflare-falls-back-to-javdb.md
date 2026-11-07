# onejav 命中 Cloudflare 时改从 javdb 取磁力，不再交给浏览器

0002 的做法是：onejav 种子链接命中 Cloudflare 拦截后，把地址交给浏览器自己过 Turnstile 并下载 `.torrent`。它解决了「脚本侧拿不到种子字节」，但没解决交付：文件落进浏览器下载目录，不归 miao，不写归档，下次进页面还会再问一遍。

**现在的做法**：onejav 的下载链条固定三级降级，口径收在 `src/site/onejav/onejav.ts` 的 `resolveOnejavSource`：

1. javdb 高分磁力（`pickJavdbMagnet` 挑出后按分数 > 0 判定，名字里的 `-c` / `-uc` 计分，中文字幕与无码优先）；
2. onejav 详情页里的种子（`resolveOnejavTorrent`，直取能解析就用）；
3. 第 2 步抛 `CloudflareBlockedError` 时，改用 javdb 磁力列表里挑出的那条（**不打分**，且**不再请求 javdb**）。

第 3 步「不走高分链接」是刻意的：走到这一步说明首选的 javdb 高分磁力已经落空，此时用户要的是「拿到能下就行」，不再挑版本；再按 `-c` / `-uc` 打分只会把一条本来可用的地址筛掉。来源与备注也随之改变 —— 徽章仍是 javdb，备注写「onejav 种子被 Cloudflare 拦截」，让用户知道为什么这次没用高分版本。三级都没命中才失败，错误文案带上 javdb 回退的原因。

**只请求一次 javdb**：第 1 步的解析出口是 `pickJavdbMagnet`，一次搜索 + 一次详情就同时返回「挑出的那条磁力 + 分数」。第 3 步直接复用第 1 步已解析到的地址，不再重跑一遍搜索 + 详情（那既慢又可能触发 FlareSolverr）；onejav 侧被拦后也不重试 —— 挑战只认顶层导航，再请求仍是 403。

**FlareSolverr 各试一次**：两处拦截都由 FlareSolverr 试一次再放手 —— 详情页这一步由 `fetchPageThroughCloudflare` 的 `flare` 参数驱动（仍是挑战页就抛拦截，走第 3 级 javdb）；拉种子字节那一步见下。两处都**只试一次**，不做轮换会话重试：挑战态下的重试只会拉长等待。

**Turnstile 不试**：CF 的挑战分两类，判定在 `src/common/cloudflare.ts` 里分开（`turnstile` / `challenge`）。Turnstile 只认真实浏览器交互，无头浏览器过不去，实测白等 60s 换来的还是挑战页 —— 所以 `isTurnstileBlock` 命中时两处都**一次都不试**，直接抛拦截；错误文案写明「Turnstile 只认真实浏览器，未尝试 FlareSolverr」，与「试了没过」「本来就不打算试」区分开（`describeFlareAttempt` 一处口径）。判定顺序上 Turnstile 先于响应头：托管挑战页常是「403 + cf-ray」，只看头会被归成封禁，调用方就分不清该不该尝试。

**交付阶段才被拦**：详情页能解析出 `.torrent` 地址，不代表种子字节拿得到 —— 真正的拦截常常发生在 `fetchTorrentBase64` 拉二进制那一刻。此时：

1. 给 `fetchTorrentBase64` 传 `flare` 坐标（`{ site: 'onejav', cookieDomain: 'onejav.com' }`，由 `flareTargetOf` 按站点给出），由 FlareSolverr 过一次挑战，用它的 cookie 重取**一次**；这次仍被拦就抛 `CloudflareBlockedError`。
2. `miaoDownload` 把这种错误折成 `status: 'blocked'`，`download()` 据此**不回退迅雷**（同一条地址换通道也过不去）并置 `blocked: true`。
3. 意图层看到 `blocked` 且解析结果带备用地址（`ResolvedDownloadSource.fallback`）时，改投备用地址一次。onejav 在第 2 级就把 `javdb.fallbackMagnet` 挂成备用地址，所以这一步同样不产生新的 javdb 请求。

**Considered options**：交付阶段被拦也回退迅雷（否决 —— 迅雷拿到的还是那条被拦的地址，等于把失败重试一遍）；FlareSolverr 无限重试（否决 —— 挑战态下的重试只会让用户多等一分钟，实测 onejav 用无头浏览器 60s 也过不去）；保留浏览器接管作为第三级之后的第四级（否决 —— 多一条不写归档的结局，用户要重新理解「下载成功」到底算不算成功）；第 3 步仍走高分磁力（否决 —— 与第 1 步等价，等于没有回退）。

**连带删除**：`src/download/browser.ts`（`handoffToBrowser`）、意图层的 `handoff` 结局与 `ResolvedDownloadSource.handoff` 字段。它们只服务于「交给浏览器」这一条路，路径没了就是死代码；意图层结局因此从五态回到四态（`blocked` / `skipped` / `submitted` / `failed`）。

**后续修订 · 过盾改由 miao 代做**：本 ADR 写成之后，「过盾」整体外包给了 miao 的 `web.fetch` / `web.download`（口径见 `CONTEXT.md` 的「过盾」：页面走 `MiaoClient.web.fetch`，字节走 `MiaoClient.web.download`）。仓库侧不再直连 FlareSolverr 管会话池，下面这些写法随之作废，三级降级本身不变：

- 「FlareSolverr 各试一次」→ 改为「命中拦截就把整页交给 miao 代取，回来的 HTML 再判一次拦截」；
- 「带 FlareSolverr 的 cookie 重取一次」→ 整段删除，仓库侧不再自己带凭证发被拦的请求。

作废的根因是 UA 无法对齐：`GM_xmlhttpRequest` 不能改 `User-Agent`（浏览器保留头，脚本管理器会丢掉），FlareSolverr 的 `request.get` 也没有 `userAgent` 参数，而 `cf_clearance` 绑定过盾浏览器自己的 UA。既然两边 UA 必然不同，解出来的凭证对浏览器侧请求就是废纸，自己带 cookie 重取只会再吃一次挑战。据此 `src/common/flare-solverr.types.d.ts` 里两个 `userAgent` 入参声明也已删除 —— 服务端不认，留着只会让人误以为能靠传 UA 对齐。
