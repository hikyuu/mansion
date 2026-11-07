/**
 * 启动 vitest 前先把 cwd 规范到磁盘上的真实盘符大小写。
 *
 * Windows 上 `process.cwd()` 的盘符大小写取决于进程是怎么被拉起来的（`d:\...` 或 `D:\...`），
 * 而 Vite 内部走 realpath，一律拿到 `GetFinalPathNameByHandle` 返回的真实大小写（`D:\...`）。
 * 两者不一致时，同一份文件在模块图里会有两套 URL：
 *
 *   file:///d:/workspace/mansion/node_modules/@vitest/runner/dist/chunk-artifact.js
 *   file:///D:/workspace/mansion/node_modules/@vitest/runner/dist/chunk-artifact.js
 *
 * 于是 `@vitest/runner` 被实例化两次：`clearCollectorContext()` 把 runner 写进其中一份，
 * 测试文件里的 `describe()` 从另一份读，读到 undefined，每个用例都在收集阶段抛
 * `Cannot read properties of undefined (reading 'config')`（或 `Vitest failed to find the runner`）。
 *
 * 配置文件里 `process.chdir()` 来不及 —— vitest 自身此时已被 Node 按旧 cwd 解析进模块缓存。
 * 必须在进程一启动就 chdir，所以在这里规范化后再以它为 cwd 拉起 vitest。
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = realpathSync.native(join(dirname(fileURLToPath(import.meta.url)), '..'))
const vitestCli = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs')

const result = spawnSync(process.execPath, [vitestCli, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: 'inherit'
})

process.exit(result.status ?? 1)
