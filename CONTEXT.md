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

- **身份**（identity）：去掉空白与分隔符，保留大小写。store 的 key 与浏览历史的 `serial_number` 用它。
- **归档键**（archiveKey）：身份之上压平 FC2 前缀、去掉开头的纯数字段并统一大写。归档表主键用它 —— 历史行就是这么存的，不要改成身份。
- **搜索变体**（searchVariant）：站点搜索框要的写法，`type` 越大越宽松；认不出格式时抛错，调用方靠这个异常走「没找到」。
- **javdb 变体**（javdbVariant）：javdb 搜索专用，全数字番号用下划线连接。

_Avoid_: ID, 编号, code

**妹妹条目**：
把列表页 DOM 里的一条妹妹读出来的结果：番号、发布日期、路径日期。站点只声明 selector，读取口径在 `src/site/sister-entry.ts` 一处，别处不得自己 `find` 番号或日期元素。
_Avoid_: item, 卡片数据, entry

**瀑布流**：
把后续分页内容解析后追加到当前页的加载方式，分懒加载与一步到位两种。
_Avoid_: 无限滚动, infinite scroll

**路径日期**（pathDate）：
浏览历史的分桶键，形如 `/2026/10/01`，每日统计按它聚合。来源由站点 selector 声明（`dateText` 从日期文本解析 / `href` 取链接 / 不填则等详情页补）。
_Avoid_: 日期, date

**已读**：
浏览历史里存在该番号的记录。
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
_Avoid_: 下载成功, downloaded, handoff 以外的「已处理」

**下载通知**：
一次下载只出一条结果通知。标题是番号（exhentai 没有番号，用画廊标题）；正文是一张「运单回执」：番号 + 状态词，hairline 之下是字段表「来源 / 通道 / 结果 / 备注」。来源是唯一的徽章，按站点身份色区分（javdb 蓝 / onejav 青 / exhentai 中性）；四态各有配色与停留时长（已投递 / 已回退 / 已取消 / 失败）。来源由站点解析器回填，onejav 回退时把「javdb 未命中：原因」写进备注；通道层不自己弹通知，回退原因并入备注，不单独弹窗。唯一出口是 `src/download/notice.ts` 的 `notifyDownload`（投递回执）与 `notifyIntent`（前置结局）。
_Avoid_: 下载成功提示, 弹窗, toast

**归档**：
记录「某个番号已交付过」的表，字段 `download_time` 指交付时刻，不代表文件已落盘。
_Avoid_: 下载记录, 历史

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
