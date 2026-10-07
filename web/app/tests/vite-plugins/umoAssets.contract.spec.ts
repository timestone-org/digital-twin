// @vitest-environment node
/** @fileoverview 报告同源资源必须来自锁定安全版本，不能复用外部包的预打包依赖。 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, it } from 'vitest'
import { umoAssets } from '../../vite-plugins/umoAssets'

const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(path.join(APP_ROOT, 'package.json'))
// ⚠ 完整 Mermaid 打包与压缩需要独立构建预算，普通用例仍使用全局超时。
const ASSET_BUILD_TIMEOUT_MS = 120_000

it(
  '生成的公式、图表与 Mermaid 使用同一锁文件的安全资源',
  async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'umo-assets-contract-'),
    )
    const output = path.join(directory, 'dist')
    const entry = path.join(directory, 'entry.js')
    await fs.writeFile(entry, 'export const fixture = true\n')
    try {
      await build({
        configFile: false,
        root: APP_ROOT,
        plugins: [umoAssets()],
        logLevel: 'silent',
        build: {
          outDir: output,
          lib: { entry, formats: ['es'], fileName: 'fixture' },
        },
      })
      const assetRoot = path.join(output, 'umo-assets', 'libs')
      expect(
        await fs.readFile(path.join(assetRoot, 'katex/katex.min.js')),
      ).toEqual(await fs.readFile(require.resolve('katex/dist/katex.min.js')))
      expect(
        await fs.readFile(path.join(assetRoot, 'katex/katex.min.css')),
      ).toEqual(await fs.readFile(require.resolve('katex/dist/katex.min.css')))
      expect(
        await fs.readFile(path.join(assetRoot, 'echarts/echarts.min.js')),
      ).toEqual(
        await fs.readFile(require.resolve('echarts/dist/echarts.min.js')),
      )
      const mermaid = await fs.readFile(
        path.join(assetRoot, 'mermaid/mermaid.min.js'),
        'utf8',
      )
      expect(mermaid).toContain('3.4.16')
      expect(mermaid).toContain('0.18.2')
      expect(mermaid).toContain('globalThis.mermaid')
      expect(
        await fs.readdir(path.join(assetRoot, 'katex/fonts')),
      ).not.toHaveLength(0)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  },
  ASSET_BUILD_TIMEOUT_MS,
)
