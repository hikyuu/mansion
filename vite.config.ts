import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monkey, { cdn } from 'vite-plugin-monkey';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: {zh:'勾栏听曲',en:'mansion'},
        description:{zh:'豪宅'},
        icon: 'https://vitejs.dev/logo.svg',
        namespace: 'npm/vite-plugin-monkey',
        match: ['*://*onejav.com/*','*://*javdb.com/*'],
        author: 'hikyuu'
      },
      build: {
        externalGlobals: {
          vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js'),
          jquery: cdn.jsdelivr('jQuery', 'dist/jquery.min.js'),
        },
      },
    }),
  ],
});
