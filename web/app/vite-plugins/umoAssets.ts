/** @fileoverview 把 Umo Editor 的外部资源作为同源静态资源提供。 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { UMO_ASSETS_DIR } from '../umoAssets.shared'

const ASSETS = [
  'libs/katex/katex.min.js',
  'libs/katex/katex.min.css',
  'libs/katex/fonts',
  'libs/mermaid/mermaid.min.js',
  'libs/echarts/echarts.min.js',
  'libs/flowchart/flowchart.js',
  'libs/flowchart/raphael.min.js',
  'libs/plantuml/plantuml-encoder.min.js',
  'libs/plyr/plyr.min.js',
  'libs/plyr/plyr.css',
  'icons',
] as const

const MIME: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function packageRoot(): string {
  const require = createRequire(import.meta.url)
  return path.dirname(require.resolve('@umoteam/editor-external/package.json'))
}

function copyAsset(source: string, target: string): void {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(target, { recursive: true })
    for (const name of fs.readdirSync(source)) {
      copyAsset(path.join(source, name), path.join(target, name))
    }
    return
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export function umoAssets(): Plugin {
  let assetRoot = ''
  return {
    name: 'umo-assets',
    configResolved() {
      assetRoot = packageRoot()
    },
    configureServer(server) {
      const prefix = `${server.config.base}${UMO_ASSETS_DIR}/`
      server.middlewares.use((request, response, next) => {
        const requestUrl = (request.url ?? '').split('?')[0] ?? ''
        if (!requestUrl.startsWith(prefix)) return next()
        const target = path.resolve(assetRoot, requestUrl.slice(prefix.length))
        if (!target.startsWith(assetRoot) || !fs.existsSync(target))
          return next()
        response.setHeader('Content-Type', contentType(target))
        fs.createReadStream(target).pipe(response)
      })
    },
    writeBundle(options) {
      const outputRoot = path.resolve(options.dir ?? 'dist', UMO_ASSETS_DIR)
      for (const relativePath of ASSETS) {
        const source = path.join(assetRoot, relativePath)
        if (!fs.existsSync(source)) {
          throw new Error(`[umo-assets] 缺少外部资源 ${relativePath}`)
        }
        copyAsset(source, path.join(outputRoot, relativePath))
      }
    },
  }
}
