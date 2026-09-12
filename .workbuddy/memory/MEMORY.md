# mansion 项目长期记忆

## 数据库 / Supabase 运维

- 线上项目：`mansion`，ref `tlxamlurkzfqblzyfztp`（组织 trstukiwtbhpdzrylqbh），本地已 `supabase link`
- **直接查改线上库**：`supabase db query --linked --agent=no -o json "<sql>"`
  - 走 Management API，**不需要 DB 密码**（CLI 2.98.2 已登录；`db query` 需 ≥ 2.79）
  - `--agent=no` 可去掉 JSON 外层的 "untrusted data" 包装；不加则用 `-o table`
  - 支持任意 SQL（含 `delete ... returning`），用 postgres 角色执行 → 绕过 RLS
- 表结构速查：
  - `hentai_archive`：id / gid / date / user_id / created_time / status / title / title_hash
    - 唯一键 `(title_hash, status, user_id)` ⇒ 同一画廊可并存 200(已下载)/304(无更新)/400(跳过) **多行**，删记录必须按 `title_hash` 一起删
    - `title_hash` = sha256(title)，gid 会随画廊重传变动，判重一律按 hash
  - `archive`：id / serial_number / download_time / user_id（按 series number 存，不存 title）
  - `browse_history` / `daily_history` / `onejav_daily`：只有日期/serial 类字段，无 title
- 删除前把整行 + 还原 SQL 备份到 `.workbuddy/backup/`

## 工程约定

- Vue 3 + TS + Vite + vite-plugin-monkey（Tampermonkey 用户脚本），站点：onejav / javdb / javstore / exhentai
- 验证三件套：`npm run type-check`、`npx oxlint <files>`、`npm run build`；仓库**没有任何 `*.test.ts`**
- 无 husky / lint-staged；CI（`.github/workflows/build-deploy.yml`）只跑 `npm ci` + `npm run build`，不跑 lint/format
- prettier 配置：printWidth 120 / semi false / singleQuote / 无尾逗号；但仓库存量代码并非 prettier-clean，
  改文件时**不要顺手全量格式化**，保持 diff 聚焦
