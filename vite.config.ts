import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import monkey from 'vite-plugin-monkey'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Icons from 'unplugin-icons/vite'
import IconsResolver from 'unplugin-icons/resolver'
import { fileURLToPath, URL } from 'node:url'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import tailwindcss from '@tailwindcss/vite'

dayjs.extend(utc)
dayjs.extend(timezone)

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    hmr: false,
    port: 9160
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  plugins: [
    tailwindcss(),
    vue(),
    AutoImport({
      imports: ['vue'],
      resolvers: [ElementPlusResolver(), IconsResolver({ prefix: 'Icon' })]
    }),
    Components({
      resolvers: [
        ElementPlusResolver(),
        IconsResolver({ enabledCollections: ['ep'] }),
        IconsResolver({
          // 自动引入的Icon组件统一前缀，默认为 i，设置false为不需要前缀
          prefix: false,
          // 标识自定义图标集
          customCollections: ['svg', 'so']
        })
      ]
    }),
    Icons({
      compiler: 'vue3',
      autoInstall: true,
      customCollections: {
        // home图标集
        // 给svg文件设置fill="currentColor"属性，使图标的颜色具有适应性
        svg: FileSystemIconLoader('src/assets/svg', (svg) => svg.replace(/fill="[^"]*"/g, 'fill = "currentColor"')),
        so: FileSystemIconLoader('src/assets/svg')
      }
    }),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: { zh: '勾栏听曲', en: 'mansion' },
        description: { zh: '别墅' },
        icon: 'https://github.com/hikyuu/gallery/raw/main/picx/mansion.svg',
        namespace: 'npm/mansion',
        match: ['*://*onejav.com/*', '*://*javdb.com/*'],
        connect: ['javstore.net', 'pixhost.to', 'javdb.com', 'onejav.com'],
        author: 'gaki',
        updateURL: updateURL(),
        downloadURL: downloadURL(),
        version: version()
      },
      build: {
        metaFileName: true,
        systemjs: 'inline',
        externalGlobals: {
          //key对应npm包名称,exportVarName对应暴露出的变量名
          // vue: cdn
          //   .jsdelivr('Vue', 'dist/vue.global.prod.js')
          //   .concat(
          //     await util.fn2dataUrl(() => {
          //       // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          //       // @ts-ignore
          //       window.Vue = Vue // work with element-plus
          //     })
          //   ),
          // jquery: cdn.jsdelivr('jQuery', 'dist/jquery.min.js')
          // pinia: cdn.jsdelivr('Pinia', 'dist/pinia.iife.prod.js'),
          // 'element-plus': cdn.jsdelivr('ElementPlus', 'dist/index.full.min.js'),
          // '@element-plus/icons-vue': cdn.jsdelivr('ElementPlusIconsVue', 'dist/index.iife.min.js')
        },
        externalResource: {
          // 'element-plus/dist/index.css': cdn.jsdelivr()
        }
      }
    })
  ]
})

function isProduction() {
  return process.env.NODE_ENV === 'production'
}

function updateURL() {
  return isProduction() ? 'https://hikyuu.github.io/mansion/mansion.meta.js' : undefined
}

function downloadURL() {
  return isProduction() ? 'https://hikyuu.github.io/mansion/mansion.user.js' : undefined
}

function version() {
  if (isProduction()) {
    return dayjs().tz('Asia/Shanghai').format('YYYY-MM-DD_HH-mm')
  }
  return '1.0.0'
}
