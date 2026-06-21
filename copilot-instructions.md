# 项目开发规范

## 角色

你是一名精通 Vue3 + TypeScript + SupaBase的高级全栈工程师，擅于使用中文思考。

## 代码风格

归一化日期使用dayjs，日期格式统一在字典里定义。
遵守vue的eslint最佳实践，使用prettier进行代码格式化。

### Prettier 格式化规范

- `npm run format` — 执行 `prettier --write src/` 格式化所有源码

## Lint 策略（增量迁移）

项目使用 **oxlint + ESLint 双运行** 策略：
- `npm run lint` — 先跑 oxlint 再跑 ESLint
- `npm run lint:ox` — 仅跑 oxlint（含自动修复）
- `npm run lint:eslint` — 仅跑 ESLint（含自动修复）
