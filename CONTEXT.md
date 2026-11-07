# mansion

油猴脚本：在 onejav / javdb / javstore / exhentai 的列表页上追加瀑布流、标记已读、并把条目交给下载通道（miao 优先，迅雷兜底）。

## Language

### 列表与导航

**妹妹**：
列表页里的一条条目（一个画廊或一个视频卡片），瀑布流的基本单位。
_Avoid_: 卡片, item, 条目

**番号**（serialNumber）：
妹妹的作品编号，浏览历史与归档的业务键。归一化后全局唯一 —— 归一只在 `src/common/serial-number.ts` 一处实现，别处不得自写 replace 链。

一个番号有四种写法，各有明确用途，不可互相替换：

- **身份**（identity）：去掉空白与分隔符，保留大小写。store 的 key 与浏览历史的 `serial_number` 用它。javdb 列表页把 FC2 写成 `FC2-4997634`（缺 PPV 段），归一化时补回，与其它站点的 `FC2-PPV-4997634` 共用同一个身份。
- **归档键**（archiveKey）：身份之上压平 FC2 前缀、去掉开头的纯数字段并统一大写。归档表主键用它 —— 历史行就是这么存的，不要改成身份。
- **搜索变体**（searchVariant）：站点搜索框要的写法，`type` 越大越宽松；认不出格式时抛错，调用方靠这个异常走「没找到」。
- **javdb 变体**（javdbVariant）：javdb 搜索专用，全数字番号用下划线连接。

_Avoid_: ID, 编号, code

**妹妹条目**：
把列表页 DOM 里的一条妹妹读出来的结果：番号、发布日期、路径日期。站点只声明 selector，读取口径在 `src/site/sister-entry.ts` 一处，别处不得自己 `find` 番号或日期元素。
_Avoid_: item, 卡片数据, entry

**瀑布流**：
把后续分页内容解析后追加到当前页的加载方式，分懒加载与一步到位两种。加载模式优先级：用户的「关闭」> 站点强制（javdb / javstore / onejav 页数多一律懒加载）> 用户配置；关闭后一次分页请求都不发（启动、滚动补页、批量翻页三处都拦）。口径在 `src/waterfall/waterfall.ts`。
_Avoid_: 无限滚动, infinite scroll

**路径日期**（pathDate）：
浏览历史的分桶键，形如 `/2026/10/01`，每日统计按它聚合。来源由站点 selector 声明（`dateText` 从日期文本解析 / `href` 取链接 / 不填则等详情页补）。
_Avoid_: 日期, date

**已读**：
浏览历史里存在该番号的记录。javdb 页面上已读卡片只留「当前条目 + 上方 19 条」这一窗口：视口稳定后若当前条目已越过 20 条窗口，就把窗口之外的更早已读卡片裁掉；当前条目还在窗口内时一条都不裁，未读卡片不动；口径在 `src/site/javdb/javdb.ts` 的 `onViewportSettled`，DOM 与 store 必须一起收窄。
_Avoid_: 看过, visited

### 下载

**下载意图**：
用户对某个番号发起的一次「去下载」请求 —— 从在途守卫、判档、提交到记账的整条流程。结局四态：`blocked`（在途重复）、`skipped`（已归档）、`submitted`、`failed`。
_Avoid_: 下载任务, download task, job

**判档**：
提交前查询归档，命中则不再重复交付；键盘 Alt 可临时跳过。
_Avoid_: 查重, dedupe, archive check

**交付**：
番号的下载地址已提交给下载通道并拿到成功结局。只有交付才写归档；复制链接通道不算交付（复制成功只代表链接已进剪贴板，文件并未交给下载器）。
_Avoid_: 下载成功, downloaded, 已处理

**备用地址**：
解析时随首选地址一起给出的第二条地址（`ResolvedDownloadSource.fallback`，如 onejav 种子 → javdb 磁力）。只有首选地址「本身被站点拦下」（`blocked`）时意图层才改投它一次；换通道也救不了同一条地址，所以这种情况不回退迅雷。备用地址必须在解析阶段就备好，交付阶段被拦时不再回头请求站点。
_Avoid_: 第二方案, plan B

**下载通知**：
一次下载只出一条结果通知。标题是番号（exhentai 没有番号，用画廊标题）；正文是一张「运单回执」：番号 + 状态词，hairline 之下是字段表「来源 / 通道 / 结果 / 备注」。来源是唯一的徽章，按站点身份色区分（javdb 蓝 / onejav 青 / exhentai 中性）；四态各有配色与停留时长（已投递 / 已回退 / 已取消 / 失败）。来源由站点解析器回填，onejav 回退时把「javdb 未命中：原因」或「onejav 种子被 Cloudflare 拦截」写进备注；通道层不自己弹通知，回退原因并入备注，不单独弹窗。唯一出口是 `src/download/notice.ts` 的 `notifyDownload`（投递回执）与 `notifyIntent`（前置结局）。
_Avoid_: 下载成功提示, 弹窗, toast

**归档**：
记录「某个番号已交付过」的表，字段 `download_time` 指交付时刻，不代表文件已落盘。
_Avoid_: 下载记录, 历史

**Cloudflare 拦截**：
CF 的挑战页 / 封禁页 / 限流页。识别口径只在 `src/common/cloudflare.ts` 一处：响应头、页面特征与最终 URL 多信号判定，404 与种子二进制不算拦截。四种形态：Turnstile 验证（turnstile）、挑战页（challenge）、访问封禁（blocked）、请求过快（rate-limited）。Turnstile 单独成一类只为排查口径：这类页面失败更可能是站点策略拒绝自动化浏览器，而不是过盾器没跑起来；过盾器换成真浏览器内核后，它不再是「跳过尝试」的理由。判定先于响应头，否则「403 + cf-ray」会被归成封禁。挑战页的最终 URL 与原 URL 相同、状态码也可能是 200，任何「URL 没变就是直链」的推断都会误判。
_Avoid_: 被墙, 反爬, 打码

**过盾**：
把「过 Cloudflare + 发请求」整体交给 miao 的 web 能力：页面走 `MiaoClient.web.fetch`（`POST /api/v1/web/fetch`，服务端真浏览器，Turnstile 也能过），二进制走 `MiaoClient.web.download`（`POST /api/v1/web/download`，回 base64，`mode: auto|http|browser`；onejav 的下载链接用 `auto`，由 `miaoBrowserDownload` 先试纯 HTTP、撞挑战再让服务端降级到浏览器下载栈）。**仓库侧不发被拦的请求**，因为 `GM_xmlhttpRequest` 改不了 `User-Agent`（浏览器保留头），而 miao 的 `cf_clearance` 绑定它自己的 UA，自己带凭证重取必然再吃挑战（FlareSolverr 的 `request.get` 同样没有自定义 UA 参数，两边 UA 无从对齐，所以凭证一律不跨栈复用）；onejav 更是对页面内 XHR 一律下挑战，浏览器栈拿不到种子字节。过盾器的安装、启停、版本与站点白名单都在 miao 里管（fail-closed），仓库不再直连 `127.0.0.1:8191` 管会话池、也不再按站点维护「过盾坐标」。通道形状在 `src/common/miao-proxy.ts`（`PageFetchProvider` / `BinaryFetchProvider`，约定不抛错），唯一实现在 `src/download/miao-proxy.ts`，调用方（`fetchPageThroughCloudflare` / `fetchTorrentBase64`）只依赖形状。代下载按**站点白名单**启用（`miao.ts` 的 `PROXY_DOWNLOAD_SITES`，当前只有 onejav）：exhentai 不需要过盾（靠浏览器登录态），走 GM 直取；白名单写法让新增站点默认不白等一次过盾。miao 侧站点白名单仍是 fail-closed，没配的会被快速拒掉。SDK 包名为 `@hikyuu/miao`（原 `@hikyuu/thunder-client`），统一用 `MiaoClient`（迅雷任务 + web 共用一份地址与 fetch），`ThunderClient` 是它的父类、仅作兼容保留。挑战没过（`CHALLENGE_FAILED` / `CHALLENGE_TIMEOUT`）或代取回来的 HTML 仍是挑战页时，调 `MiaoClient.web.invalidate(origin)` 销毁 miao 侧该站点的会话：坏会话留着只会让下一次命中同一份凭证再撞一次墙，销毁后才会重新过盾；因此不再保留「最近失败过」的快失败记忆，每次下载意图都会真正发一次请求。
_Avoid_: 绕盾, bypass, 过验证码

**浏览器接管**：
已废弃。曾用于 onejav：命中 Cloudflare 拦截后把种子地址交给浏览器自己过 Turnstile。放弃的原因是文件落进浏览器下载目录、不进 miao，等于没交付；现在改为从 javdb 取磁力（见「onejav 下载链条」）。

**磁力挑选**：
javdb 详情页多条磁力里选哪一条：高分（名字里带 `-c` 中文字幕 / `-uc` 无码）→ 标签多（`div.tags` 下的 `span.tag`，如高清）→ 页面顺序第一个，三级依次降级。口径只在 `src/site/javdb/javdb-api.ts` 的 `pickMagnet` 一处；`pickJavdbMagnet` 把分数一并交给调用方，只有 onejav 的第一级要求分数 > 0，其余入口不设门槛。
_Avoid_: 最佳种子, 择优

**onejav 下载链条**：
onejav 下载意图的地址解析顺序，三级降级：javdb 高分磁力 → onejav 种子（`resolveOnejavTorrent`：`.torrent` / `file.*` 直链直接交给下载通道，页面才取回来找下载按钮） → 种子链接被 Cloudflare 拦下时改用 javdb 磁力。javdb 只请求一次：`pickJavdbMagnet` 一次解析就同时带出「挑出的那条 + 分数」（`src/site/javdb/javdb-api.ts`），第三级复用同一次解析里挑出的那条，不再发第二次搜索 / 详情请求。第三级不设高分门槛，只求拿得到地址：onejav 的挑战只认顶层导航，XHR / GM 请求一律 403，被拦后先过一次盾（miao），仍失败就不再重试 onejav。三级口径只在 `src/site/onejav/onejav.ts` 的 `resolveOnejavSource` 一处。

解析成功不等于拿得到字节：onejav 的种子链接**只走** `web.download({ mode: 'auto' })`（`fetchTorrentBase64` 的 `proxyOnly`），代下载失败不再回落 GM —— 那条请求必被 Turnstile 拦下，白等超时还会盖住 miao 的真实失败原因；直接抛 `blocked`，由意图层改投第 2 级就挂好的备用地址（javdb 磁力），不回退迅雷、不重试 onejav。其余站点（exhentai）仍走 GM 直取，代下载失败才回落。

详情页这一步同样只给一次机会：`fetchPageThroughCloudflare` 命中拦截就把整页交给 miao 代取（`web.fetch`），回来的 HTML 再判一次拦截，仍被拦就抛拦截，交给第 3 级。两处都只试一次（失败原因取自 miao 的错误码，写进拦截文案），Turnstile 也照试 —— 过盾器是真浏览器内核，旧的「无头浏览器过不去」前提不再成立。失败后的会话销毁见「过盾」：本次意图仍只试一次，但下一次意图不会被「最近失败过」挡住。
_Avoid_: 兜底链, fallback chain

### exhentai

**画廊**：
exhentai 列表页上的一个妹妹，用标题 hash 判重（gid 会随重传变动，只作追溯元数据）。
_Avoid_: 本子, gallery item

**过时种子**：
下载页 `Outdated Torrents:` 标题之后的种子。命中过时种子记 304，表示「本次未下载最新版本，下次进页面继续复查」。
_Avoid_: 旧种子, 老种子

**水位线**：
判重的日期阈值 = 状态为 200 / 304 的归档记录里的最大 `date`（400 用户跳过不参与）。画廊日期比水位线新才算有新版本；列表页与下载 handler 必须共用同一口径。
_Avoid_: 阈值, 最新日期, watermark 以外的说法
