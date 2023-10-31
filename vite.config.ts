import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monkey, { cdn, util } from 'vite-plugin-monkey'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    hmr: false,
    port: 3003
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue'],
      resolvers: [ElementPlusResolver(), IconsResolver({ prefix: 'Icon' })]
    }),
    Components({
      resolvers: [ElementPlusResolver(), IconsResolver({ enabledCollections: ['ep'] })]
    }),
    Icons({
      autoInstall: true
    }),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: { zh: '勾栏听曲', en: 'mansion' },
        description: { zh: '豪宅' },
        icon: 'https://vitejs.dev/logo.svg',
        namespace: 'npm/mansion',
        match: ['*://*onejav.com/*', '*://*javdb.com/*'],
        author: 'hikyuu'
      },
      build: {
        externalGlobals: {
          //key对应npm包名称,exportVarName对应暴露出的变量名
          vue: cdn.jsdelivr('Vue', 'dist/vue.global.prod.js').concat(
            await util.fn2dataUrl(() => {
              // @ts-ignore
              window.Vue = Vue // work with element-plus
            })
          ),
          jquery: cdn.jsdelivr('jQuery', 'dist/jquery.min.js'),
          moment: cdn.jsdelivr('moment', 'moment.min.js'),
          'realm-web': cdn.jsdelivr('Realm', 'dist/bundle.iife.js'),
          'element-plus': cdn.jsdelivr('ElementPlus', 'dist/index.full.min.js'),
          '@element-plus/icons-vue': cdn.jsdelivr('ElementPlusIconsVue', 'dist/index.iife.min.js')
        },
        externalResource: {
          'element-plus/dist/index.css': cdn.jsdelivr()
        }
      }
    })
  ]
})
