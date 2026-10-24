---
name: download-notice-unify
overview: 统一下载通知：标题用番号，正文固定为「来源 → 通道：结局」，区分 javdb 高分磁力 / onejav 种子 / 其它站点来源，覆盖 miao、迅雷、复制三个通道，javdb 回退原因合并进最终通知而不是单独弹窗。
todos:
  - id: add-notice-module
    content: 新增 src/download/notice.ts：DownloadSource 类型、formatDownloadNotice 与 notifyDownload，并补 download-notice.test.ts
    status: completed
  - id: silence-channels
    content: 收敛通道通知：miao/thunder/clipboard 去通知，download() 返回 outcome、fallbackReason、message
    status: completed
    dependencies:
      - add-notice-module
  - id: intent-notify
    content: 改造 submitDownload 支持 { url, source }，所有结局统一以番号为标题发通知
    status: completed
    dependencies:
      - add-notice-module
  - id: site-sources
    content: onejav 回填 javdb 高分磁力/onejav 种子与未命中原因，javdb/javstore 标注来源
    status: completed
    dependencies:
      - intent-notify
  - id: exhentai-notice
    content: exhentai 下载通知改用 notifyDownload，标题为画廊标题并保留 silent
    status: completed
    dependencies:
      - silence-channels
      - add-notice-module
  - id: update-tests
    content: 更新 download-intent 与 miao-download 测试，新增 onejav-source 测试并跑 typecheck/vitest
    status: completed
    dependencies:
      - intent-notify
      - site-sources
      - exhentai-notice
  - id: update-context
    content: 在 CONTEXT.md 补充下载通知口径：标题=番号，正文=来源→通道：结局
    status: completed
    dependencies:
      - update-tests
---

## 用户需求

### 需求背景

onejav 下载时会先取 javdb 高分磁力，取不到则静默回退 onejav 自身种子，用户看不到任何提示，也无法分辨本次到底用了哪个来源；miao 等通道的通知标题与文案各自为政（`miao` / `迅雷下载` / `提示` / 站点名），不带番号，连续下载时难以对应。

### 核心功能

- 下载通知统一格式：**标题 = 番号**，正文 = **「来源 → 通道：结局」**，例如
- `ABC-123` / `javdb 高分磁力 → miao：已添加 miao 任务 #12`
- `ABC-123` / `onejav 种子（javdb 未命中：没有找到高分磁力链接） → 迅雷（miao 回退）：已添加到迅雷任务列表`
- 通知中必须区分四个维度：
- 地址来源：javdb 高分磁力 / onejav 种子（javdb、javstore 站点标注各自磁力来源）
- 下载通道：miao / 迅雷 / 剪贴板，以及是否发生 miao 回退迅雷
- 当前番号
- javdb 未取得磁力的原因（无搜索结果 / 无磁力 / 最高分为 0 / FC2 不支持等）
- javdb 无高分磁力时不单独弹 warning，原因合并进最终成功通知；只有 javdb 与 onejav 都取不到地址时才作为失败提示。
- 通道层不再各自弹通知，统一由下载意图层出口，保证标题一定是番号；exhentai 队列的静默语义保留。

### 视觉与交互效果

不新增界面元素，仅改造 Element Plus 通知的内容与类型：成功为 success、回退为 warning、失败为 error、用户取消为 info；每次下载只弹一条结果通知，避免连续下载时刷屏或无法对应。

## 技术栈

沿用现有工程：Vue 3 + TypeScript + Vite（vite-plugin-monkey）+ Element Plus `ElNotification` + Vitest。不引入新依赖。

## 现状约束（已核实）

- `src/site/onejav/onejav.ts` 的 `resolveJavdbMagnet` 把所有 javdb 异常吞成 `null` + `console.warn`，回退完全静默。
- `src/download/intent.ts` 的 `SubmitDownloadInput.resolveSource: () => Promise<string | null>`，且注释明确「提示由 download() 内的通道自己出」。
- 通道内部各自发通知：`miao.ts`（成功 / 取消选择）、`thunder.ts`（silent 开关）、`clipboard.ts`（异步复制完成后按站点名弹）。
- `src/download/index.ts` 的回退分支自己弹 `'迅雷下载'`。
- `src/site/exhentai/exhentai-download-handler.ts` 不走 `submitDownload`，直接 `download()`，自带 `notify()` 且支持队列静默。
- `CONTEXT.md` 规定：只有交付（提交给通道且非 copy）才写归档，copy 的成功是乐观值。

## 实现策略

采用「解析来源 → 下载意图 → 通道 → 通知编排」四层职责：

1. **新增通知编排模块 `src/download/notice.ts`**：只做纯格式化 + 唯一出口，避免各调用点重复拼串。

- `DownloadSource { label: string; note?: string }`：`label` 进入正文，`note` 承载「javdb 未命中原因」。
- `formatDownloadNotice(input)` 纯函数：拼 `来源（note） → 通道：结局`，并决定 `success|warning|error|info`。
- `notifyDownload(input)`：内部调用 `ElNotification`，标题取番号（无番号场景如 exhentai 传画廊标题）。

2. **`src/download/index.ts` 结果结构化**：`DownloadSubmitResult` 增加 `outcome: 'created'|'cancelled'|'failed'`、`fallbackReason?: string`，`message` 收敛为「不含来源/通道前缀」的通道侧文案，供通知层拼接。通道层全部静默。
3. **`src/download/intent.ts` 支持来源并统一出通知**：`resolveSource` 返回 `{ url, source } | null`；成功、回退、失败、无地址、在途、已归档均由意图层用 `notifyDownload` 发出（标题固定为番号）。
4. **各站点回填来源**：

- onejav：`resolveJavdbMagnet` 改为返回 `{ magnet: string | null; reason?: string }`；命中→`javdb 高分磁力`；未命中→`onejav 种子` + `note: 'javdb 未命中：' + reason`；两者皆空→抛错并把 javdb 原因拼进文案。
- javdb 站点 → `javdb 磁力`；javstore → `javdb 磁力`。
- exhentai：`download()` 后使用 `notifyDownload`，`source: { label: 'exhentai 种子' }`，标题用画廊标题，保留 `silent`。

5. **copy 通道真实化**：`copyUrl` 由「入队即返回 true」改为返回 `Promise<{ ok, message }>`，在节流队列内完成时 resolve，通道内不再发通知。记账口径不变（copy 仍不写归档）。

## 关键决策与取舍

- **通知归属上移**：只有意图层/画廊 handler 同时掌握番号与来源，通道层拿不到番号，若继续在通道内弹就无法满足「标题=番号」。代价是通道层返回信息必须足够（`outcome` + `fallbackReason` + `message`）。
- **失败原因结构化而非拼字符串**：onejav 以 `reason` 字段上传 javdb 失败原因，避免上层靠解析异常文案；只有「两者都没有」时才把原因并入异常消息。
- **复制通道 Promise 化**：让通知反映真实复制结果而不是「已入队」；仍保持 1s 节流与串行队列，批量场景最多多等 1s，属于可接受开销，且值守释放更准确。
- **不新增通知库、不改 UI**：沿用 `ElNotification`，类型映射到现有四种语义。

## 性能与可靠性

- 不增加网络请求与 DOM 遍历；onejav 仍是一次 javdb 解析 + 一次 onejav 页面解析，仅多返回一个字符串原因。
- 通知条数下降（javdb 失败不再单独弹），批量下载不再刷屏。
- 通知拼串为 O(1)，无额外内存压力。
- 失败路径不改变在途守卫与记账逻辑，兜底仍是「javdb 异常 → onejav 种子」，异常不会中断下载。

## 架构设计

```mermaid
flowchart LR
  A[站点 download] -->|resolveSource 返回 url+source| B[submitDownload 意图层]
  B -->|download(url)| C[download 分发层]
  C --> D[miao 通道]
  C --> E[迅雷通道]
  C --> F[剪贴板通道]
  D -->|DownloadSubmitResult| C
  E --> C
  F --> C
  C -->|结构化结果| B
  B -->|notifyDownload 标题=番号| G[notice.ts 唯一通知出口]
  H[exhentai handler] -->|download + notifyDownload 标题=画廊| G
```

## 目录结构

```
src/
├── download/
│   ├── notice.ts            # [NEW] 通知编排：DownloadSource 类型、formatDownloadNotice 纯函数、notifyDownload 出口
│   ├── index.ts             # [MODIFY] DownloadSubmitResult 增加 outcome/fallbackReason；通道全部静默；copy 分支 await 真实结果
│   ├── intent.ts            # [MODIFY] resolveSource 返回 { url, source }；所有结局统一 notifyDownload（标题=番号）
│   ├── miao.ts              # [MODIFY] 删除成功/取消的 ElNotification，MiaoAttempt 保留 message 与 status
│   ├── thunder.ts           # [MODIFY] 删除 ElNotification 与 silent 分支，只返回成败
│   └── clipboard.ts         # [MODIFY] copyUrl 返回 Promise<{ok,message}>，节流队列内 resolve，删除通知
├── site/
│   ├── onejav/onejav.ts     # [MODIFY] resolveJavdbMagnet 返回 { magnet, reason }；download 回填来源与未命中原因
│   ├── javdb/javdb.ts       # [MODIFY] resolveSource 返回 { url, source: { label: 'javdb 磁力' } }
│   ├── javstore/javstore.ts # [MODIFY] resolveSource 返回 { url, source: { label: 'javdb 磁力' } }
│   └── exhentai/exhentai-download-handler.ts  # [MODIFY] 通知改用 notifyDownload，标题=画廊标题，保留 silent
├── __tests__/
│   ├── download-notice.test.ts   # [NEW] 格式纯函数单测：成功/回退/失败/copy/note 拼接/无番号标题
│   ├── onejav-source.test.ts     # [NEW] javdb 失败原因传递与 onejav 来源判定
│   ├── download-intent.test.ts   # [MODIFY] resolveSource mock 改结构化返回；断言标题=番号与「来源 → 通道」
│   └── miao-download.test.ts     # [MODIFY] 通道不再弹通知；断言 outcome/fallbackReason/message
CONTEXT.md                     # [MODIFY] 补充「下载通知」口径：标题=番号，正文=来源→通道：结局，回退原因合并
```

## 关键接口（接口级约定）

```ts
// src/download/notice.ts
export interface DownloadSource {
  label: string          // 'javdb 高分磁力' | 'onejav 种子' | 'javdb 磁力' | 'exhentai 种子'
  note?: string          // 如 'javdb 未命中：没有找到高分磁力链接'
}

export interface DownloadNoticeInput {
  title: string                                  // 番号；exhentai 传画廊标题
  source?: DownloadSource
  result: DownloadSubmitResult
}

export function formatDownloadNotice(input: DownloadNoticeInput): {
  type: 'success' | 'warning' | 'error' | 'info'
  message: string
}
export function notifyDownload(input: DownloadNoticeInput): void

// src/download/index.ts
export interface DownloadSubmitResult {
  ok: boolean
  channel: 'miao' | 'thunder' | 'copy'
  fellBack: boolean
  fallbackReason?: string          // 仅 fellBack：miao 侧原因
  outcome: 'created' | 'cancelled' | 'failed'
  message: string                  // 通道侧文案，不含来源与通道前缀
}

// src/download/intent.ts
export interface ResolvedDownloadSource {
  url: string
  source: DownloadSource
}
export interface SubmitDownloadInput {
  serialNumber?: string
  checkArchive: boolean
  resolveSource: () => Promise<ResolvedDownloadSource | null>
}
```

## 执行注意事项

- `miao.ts` 的 `created` 文案（含「任务已存在」）与 `cancelled` 文案保持原意，仅去掉通知调用，避免行为回归。
- `thunder.ts` 删除 `silent` 参数会改变 `miao-download.test.ts` 的 `{ silent: true }` 断言，需同步；同时确保 `download()` 的回退文案仍包含原因。
- 解析失败提示的文案统一为「解析下载地址失败：原因」，无地址为「没有找到下载地址」，均以番号为标题。
- 复制通道改为 await 后会延长在途守卫约 1s（节流间隔），属预期行为，不要为此放宽守卫。
- `CONTEXT.md` 中「copy 成功是乐观值」的记账口径不变，仅通知时机变准。
- 不修改 exhentai 队列的 `silent`（批量静默）与归档逻辑；不触碰 `haveArchived/upsertArchive`。