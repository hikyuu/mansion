import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// 独立测试入口：不加载 vite.config.ts（其中的 vite-plugin-monkey 插件不适用于单测）
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@miao/thunder-client': fileURLToPath(new URL('../flutter/miao/sdk/ts/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts']
  }
})
