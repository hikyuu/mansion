# AGENTS.md — 本地 zip 补录到 hentai_archive

给接手这个任务的 agent 看的操作手册。**先读「0. 接手第一步」，再动手。**

---

## 0. 接手第一步

```bash
node scripts/import-zip-archive/run.mjs status
```

输出里的 `next` 就是当前该做的事，`lock` 说明有没有别的进程在跑，`unresolvedFuzzy` 说明还有多少条待裁决。

不要假设进度：进度全部来自 `state/` 下的日志文件，与之前任何汇报的数字无关。

---

## 1. 这个功能在做什么

把本地已下载的画廊 zip（`Y:\ehviewer\animated`，1303 个）补录进 Supabase 的 `hentai_archive`，让 exhentai 页面上的判定（按 `title_hash`）认得出"已下载过"，不再重复下载。

同时在旁路表 `hentai_import_log` 打标记，用于区分"补录"与"线上正常下载"。

**明确不做**：不修改 `hentai_archive_event` / 视图 / `upsert_hentai_archive` RPC；不删 `hentai_gallery`；不动浏览器用户脚本（原面板链路已删除）。

---

## 2. 前置条件

| 项 | 说明 |
|---|---|
| cookie 文件 | `%TEMP%\exhentai-cookies.txt`，可为 `name=value; …`、DevTools「Copy as cURL」整条命令、或带 `Cookie:` 头的文本。**必须含 `ipb_member_id` 与 `ipb_pass_hash`** |
| CLI | `supabase` 已 `link` 到项目 `tlxamlurkzfqblzyfztp`，`supabase db query -f … --linked` 可用 |
| 迁移 | `supabase/snippets/20261021-01-import-log.sql` 已执行（`hentai_import_log` 存在） |
| 目标用户 | `608bc996-7b53-4eb7-8068-201556307a96`（脚本默认值，可用 `--uid` 覆盖） |

cookie 是**凭据**：不要打印、不要提交、不要贴进对话；用完提醒用户改密码（`ipb_pass_hash` 不会因退出登录而失效）。

---

## 3. 状态模型（`scripts/import-zip-archive/state/`）

| 文件 | 作用 | 入库 |
|---|---|---|
| `files.json` | 目录扫描快照（fileName / mtime / rawTitle / gidHint） | 是 |
| `verified.jsonl` | 校验结果，**每条一行** | 是 |
| `decisions.jsonl` | 人工/AI 裁决，**每条一行** | 是 |
| `apply.jsonl` | 已成功执行的批次 | 是 |
| `run.lock` | 运行锁（pid + host + command） | 否 |
| `sql/` | `batch-*.sql`、`rollback-<batchId>.sql`、`manifest.json` | 否 |
| `verify.out.log` / `.err.log` | 后台运行日志 | 否 |

**读取口径**：所有 `.jsonl` 都是 append-only，**同名 fileName 后写覆盖先写**（fold）。重跑某一条不会破坏历史，也不需要重写整个文件。

**写入口径**：每条结果 `append + fsync` 落盘后才算完成；中断最多丢"正在请求的那一条"。

**锁**：`verify` / `apply` 启动时抢锁。同机且 pid 存活 → 拒绝启动；锁过期或异机 → 打印提示后接管。不要手动删锁，除非确认对应进程已死。

---

## 4. 命令矩阵

```bash
node scripts/import-zip-archive/run.mjs <命令> [选项]     # --out 可改状态目录
```

| 命令 | 用途 | 关键参数 |
|---|---|---|
| `scan` | 扫描目录生成 `files.json` | `--dir` |
| `verify` | 逐条搜索校验，结果追加到 `verified.jsonl` | `--limit N`、`--interval ms`(默认 2000)、`--retry`、`--file 子串`、`--force` |
| `status` | 交接摘要 | — |
| `report` | 生成 `report.md/json`、`disputed.json` | — |
| `inspect` | 看单条结果与候选 | `--file 子串` |
| `decide` | 记录裁决 | `--file "<完整文件名>"` + `--gid N [--title ""]` 或 `--skip`，`--reason` |
| `build` | 合并 verify+decide，查重后生成 SQL | `--overwrite`、`--no-check-db`、`--include-fuzzy`、`--batch-size` |
| `apply` | 执行 SQL | **必须 `--yes`**；已执行批次自动跳过 |
| `rollback` | 按批次回滚 | `--batch <batchId> [--yes]` |
| `verify-db` | 打印导入统计 | — |

`verify` 可随时 Ctrl+C（或 `Stop-Process -Id <锁里的 pid>`），重跑自动续。后台跑法：

```powershell
Start-Process node -ArgumentList 'scripts/import-zip-archive/run.mjs','verify','--interval','2000' `
  -WorkingDirectory 'd:/workspace/mansion' `
  -RedirectStandardOutput 'scripts/import-zip-archive/state/verify.out.log' `
  -RedirectStandardError  'scripts/import-zip-archive/state/verify.err.log' -WindowStyle Hidden
```

---

## 5. 匹配分级（什么算"无争议"）

判定顺序：**gid 提示命中 → exact → equivalent → sole → unique/score → fuzzy → skip**

| level | 条件 |
|---|---|
| `gid` | 文件名尾部 `[数字]` 与某候选 gid 相同（`YYYYMMDD` 不算 gid） |
| `exact` | 标题 NFKC + 空白压缩后全等 |
| `equivalent` | 消毒后一致 / 255 截断一致 / 去掉全部空白并忽略大小写后一致（站点常写驼峰）/ 文件名是标题短版（≥20 字符前缀、多余 ≤40） |
| `sole` | 多词查询（≥3 词元）**只命中 1 条**——站点搜索要求全部词元命中 |
| `unique` | 独特单词查询（日文 ≥4 字 / 英文 ≥12 字符）只命中 1 条 |
| `score` | 加权分 ≥ 0.85（token 相似度 0.6 / 画师标签 0.2 / gid 命中 0.15 / 发布日期接近 0.05） |
| `fuzzy` | 有候选但分数 0.55–0.85，或独特单词查询命中 ≤5 条 → **必须裁决** |
| `skip` | 候选明显不相关（分数 <0.55 且非独特单词查询） |
| `notFound` | 所有关键词变体都零结果 |

搜索关键词逐级降级：完整标题 → 去尾部括号组 → 去开头括号组 → **去所有括号组**（跨语言标题只有这一档能命中）→ 前 8/6 词元 → 最长词元。

**跨语言标题**（本地日文名、站点罗马音，如 `夏への方舟` vs `Natsu e no Hakobune`）脚本只能给候选，必须人工按画师、副标题、页数判断。

---

## 6. 裁决（`decide`）实操

```bash
node scripts/import-zip-archive/run.mjs inspect --file "胡桃まんぐりっクス"
node scripts/import-zip-archive/run.mjs decide \
  --file "(同人CG集) [MだSたろう & Yakin] 胡桃まんぐりっクス [Animated] (原神).zip" \
  --gid 3400664 --title "[Mda Starou & Yakin] 胡桃まんぐりっクス [Animated] (Genshin Impact)" \
  --reason "日文核心词全等；另一候选缺 [Animated]"
```

- `--file` 必须是**完整文件名**（先用 `inspect --file 子串` 查）。
- `--gid` 不在该条候选里时必须同时给 `--title`，脚本会校验并提示。
- **标题必须是站点返回的原文**（全角/半角、空格都要一致），否则 `title_hash` 与列表页对不上，判重失效。
- 判断依据优先级：gid 提示 → 画师标签 → 副标题/版本 → **页数与 zip 内条目数一致**（`tar -tf "<zip>" | Measure-Object` 数条目）→ 发布日期与 zip mtime 接近。
- 确实没有对应画廊（用户自拟的集合名）就 `--skip --reason "…"`。

---

## 7. 写库契约（`build` / `apply`）

`apply` 用 `supabase db query -f`，以 **postgres 身份直接写**，绕过 RLS 与 RPC，所以 SQL 必须自己复刻语义：

```sql
begin;
-- ① 画廊：hash 由库侧 sha256(title) 派生；gid=0 不覆盖共享目录里的真实 gid
insert into public.hentai_gallery as gal (title, title_hash, gid) …
on conflict on constraint hentai_gallery_title_hash_unique do update
  set gid = case when excluded.gid > 0 then excluded.gid else gal.gid end, updated_time = now();

-- ② 事件：uid 显式（没有 auth.uid()），status=200，水位线 = zip mtime
insert into public.hentai_archive_event (user_id, gallery_id, status, watermark_date) …
on conflict on constraint hentai_archive_event_user_id_gallery_id_status_unique do update
  set watermark_date = excluded.watermark_date, updated_time = now();

-- ③ 补录标记：batch_id 固定，便于统计与回滚
insert into public.hentai_import_log (…) …
on conflict on constraint hentai_import_log_user_id_title_hash_unique do update …;

-- ④ 断言：本批标记数 = 累计期望；且每条标记都能 join 到 200 事件
do $$ … $$;
commit;
```

不变式（改动时别破坏）：

1. **按用户事件判重**，不是按 `hentai_gallery` 是否存在（那是全局共享目录，别人归档过不代表我归档过）。
2. 同一 `title_hash` 多文件只写一次，水位线取 **min(mtime)**（宁可偏低也不抬高，否则会挡住真实更新）。
3. 一批一个事务；断言失败整批回滚。
4. `apply.jsonl` 记录已成功批次，重跑自动跳过（幂等）。
5. 回滚：`rollback --batch <id>` 只删该批的 200 事件与标记，**不删 `hentai_gallery`**。

---

## 8. 常见故障

| 现象 | 处置 |
|---|---|
| `IP 被临时封禁（剩余约 N 分钟）` | 站点返回 200 + 242 字节纯文本（`temporarily banned due to an excessive request rate`）。加 `--wait-ban` 会自动睡到解封并重试同一条；不加则停下等手动重跑。建议同时把 `--interval` 提到 4000 |
| `搜索被限流（HTTP 509）` | 已自动停并保存进度。等 10–30 分钟再 `verify`，或把 `--interval` 调到 3000–5000 |
| `页面被拦截或登录已失效` | cookie 过期。重新导出到 `%TEMP%\exhentai-cookies.txt`，再 `verify --force`（只重跑失败项） |
| `无法识别搜索结果页结构` | 站点改版。`search.mjs` 会打印前 500 字符样本；对照 `lib.mjs:parseSearchPage` 修选择器，再 `verify --file <子串> --force` |
| `已有进程在跑（pid …）` | 另一个 agent 在跑。先 `status` 看锁；确认已死再删 `state/run.lock` |
| `apply` 某批失败 | 该批未记入 `apply.jsonl`，事务已回滚。修好网络/SQL 后重跑 `apply --yes`，从这一批继续 |
| 标记数与事件数不一致 | 断言会拦住。若是绕过脚本手工写过数据，用第 9 节 SQL 定位孤儿行 |

**不要并发跑 `verify`**：两个进程会重复请求同一批文件，且容易触发限流。

---

## 9. 核对 SQL

```sql
-- 本批次写入情况
select count(*) from public.hentai_import_log where batch_id = '<batchId>';
select count(*) from public.hentai_archive_event where user_id = '<uid>' and status = 200;

-- 标记必须都有对应画廊（孤儿标记）
select count(*) as orphan_logs
  from public.hentai_import_log l
  left join public.hentai_gallery g on g.title_hash = l.title_hash
 where g.id is null;

-- 本批标记是否都有 200 事件
select count(*) from public.hentai_import_log l
  join public.hentai_gallery g on g.title_hash = l.title_hash
  join public.hentai_archive_event e
    on e.gallery_id = g.id and e.user_id = l.user_id and e.status = 200
 where l.batch_id = '<batchId>';
```

也可以直接 `node … run.mjs verify-db`。

---

## 10. 全量流程

```bash
# 1) 校验跑到 pending = 0（可分批、可中断）
node scripts/import-zip-archive/run.mjs status
node scripts/import-zip-archive/run.mjs verify --limit 200

# 2) 出报告，处理 disputed（fuzzy / notFound）
node scripts/import-zip-archive/run.mjs report
node scripts/import-zip-archive/run.mjs decide --file "…" --gid N --title "…" --reason "…"

# 3) 生成 SQL，先 dry-run 看规模
node scripts/import-zip-archive/run.mjs build
node scripts/import-zip-archive/run.mjs apply

# 4) 用户确认后执行，再核对
node scripts/import-zip-archive/run.mjs apply --yes
node scripts/import-zip-archive/run.mjs verify-db
```

`build` 默认跳过"该用户已有 200/304 事件"的画廊；`--overwrite` 才覆盖（会把水位线刷成 zip mtime，慎用）。

---

## 11. 红线

- 不把 cookie 写进仓库、日志、对话。
- 不手工 SQL 直写 `hentai_archive_event` / `hentai_import_log` 绕过脚本（会破坏断言与 `apply.jsonl` 的一致性）。
- 不删 `hentai_gallery` 行（共享目录，`on delete restrict`，且会影响其它用户）。
- 不修改 `hentai_archive` 视图与 `upsert_hentai_archive` RPC（补录是旁路，不改主链路）。
- 不把 `state/sql/`、`state/*.log`、`state/run.lock` 提交进仓库（已在 `state/.gitignore` 排除）；`*.jsonl` 与 `files.json` 才是需要共享的进度。
- 执行任何 `apply --yes` 前，必须先让用户看过 `build` 的统计和批次。
