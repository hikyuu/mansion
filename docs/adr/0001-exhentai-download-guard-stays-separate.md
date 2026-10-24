# exhentai 的下载守卫与通知不并入下载意图模块

三站（javdb / javstore / onejav）的「下载意图」收进 `src/download/intent.ts`，exhentai 刻意不并入：它的在途守卫挂在下载按钮节点上，防的是「手动点击」与「队列执行」这对必然经过同一节点的并发；而三站的守位键是番号，exhentai 侧只有 gid 与标题 hash。它的通知文案也属于画廊语境（最新种子 / 过时种子 / 304），与三站共用只能靠映射两套结果类型。全局一致的只有记账规则：交付才写归档。

**Considered options**：守卫键统一为任意字符串、`activeDownloads` 改成 `{ id, label }`（否决 —— 为一个只可见 1~2 秒的 UI 需求给 interface 加字段）；抽出 `notifyDownload(tone, message)` 共用（否决 —— deletion test 下是 pass-through，删掉后每个调用方只补一行 `ElNotification`）。
