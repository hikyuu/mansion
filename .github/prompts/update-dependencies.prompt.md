---
description: '使用 npm-check-updates 检查并更新项目依赖到最新版本'
agent: 'agent'
---

使用 npm-check-updates 更新项目依赖，按以下步骤执行：

## 步骤

1. **检查可更新依赖**：运行 `npm-check-updates` 查看所有可更新的依赖包列表
2. **更新 package.json**：运行 `npm-check-updates -u` 将 package.json 中的依赖版本更新到最新
3. **重新安装依赖**：运行 `npm install` 安装更新后的依赖

## 注意事项

- 遵循项目现有依赖管理风格（^ 前缀等）
- 如果更新后出现问题，分析错误并适当回滚或降级特定包
