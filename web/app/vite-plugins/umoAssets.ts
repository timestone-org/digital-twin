/** @fileoverview 把 Umo Editor 的外部资源作为同源静态资源提供。 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'vite'
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

function assetSource(assetRoot: string, relativePath: string): string | null {
  if (
    !ASSETS.some(
      (asset) => relativePath === asset || relativePath.startsWith(`${asset}/`),
    )
  )
    return null
  const require = createRequire(import.meta.url)
  const katexRoot = path.dirname(require.resolve('katex/dist/katex.min.js'))
  const roots = [
    ['libs/katex/', katexRoot],
    [
      'libs/echarts/',
      path.dirname(require.resolve('echarts/dist/echarts.min.js')),
    ],
  ] as const
  const mapped = roots.find(([prefix]) => relativePath.startsWith(prefix))
  const root = mapped?.[1] ?? assetRoot
  const source = path.resolve(
    root,
    mapped ? relativePath.slice(mapped[0].length) : relativePath,
  )
  const relative = path.relative(root, source)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return fs.existsSync(source) ? source : null
}

async function bundleMermaid(): Promise<string> {
  const require = createRequire(import.meta.url)
  const entry = path.resolve('virtual:umo-mermaid')
  const moduleId = '\0umo-mermaid'
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'umo-mermaid-runtime',
        resolveId: (id) => (id === entry ? moduleId : undefined),
        load: (id) =>
          id === moduleId
            ? `import mermaid from ${JSON.stringify(require.resolve('mermaid'))}; globalThis.mermaid = mermaid;`
            : undefined,
      },
    ],
    build: {
      write: false,
      minify: true,
      target: 'es2022',
      lib: { entry, formats: ['iife'], name: 'UmoMermaid' },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
  const outputs = Array.isArray(result) ? result : [result]
  for (const output of outputs) {
    if ('output' in output) {
      const script = output.output.find((asset) => asset.type === 'chunk')
      if (script?.type === 'chunk') return script.code
    }
  }
  throw new Error('[umo-assets] Mermaid 未生成脚本')
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
  let mermaidScript = ''
  return {
    name: 'umo-assets',
    async configResolved() {
      assetRoot = packageRoot()
      // ⚠ 必须从 ESM 入口重打包，预打包 Mermaid 不会使用锁定的 DOMPurify/KaTeX。
      mermaidScript = await bundleMermaid()
    },
    configureServer(server) {
      const prefix = `${server.config.base}${UMO_ASSETS_DIR}/`
      server.middlewares.use((request, response, next) => {
        const requestUrl = (request.url ?? '').split('?')[0] ?? ''
        if (!requestUrl.startsWith(prefix)) return next()
        const relativePath = requestUrl.slice(prefix.length)
        if (relativePath === 'libs/mermaid/mermaid.min.js') {
          response.setHeader('Content-Type', contentType(relativePath))
          response.end(mermaidScript)
          return
        }
        const target = assetSource(assetRoot, relativePath)
        if (target === null || !fs.statSync(target).isFile()) return next()
        response.setHeader('Content-Type', contentType(target))
        fs.createReadStream(target).pipe(response)
      })
    },
    writeBundle(options) {
      const outputRoot = path.resolve(options.dir ?? 'dist', UMO_ASSETS_DIR)
      for (const relativePath of ASSETS) {
        const target = path.join(outputRoot, relativePath)
        if (relativePath === 'libs/mermaid/mermaid.min.js') {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          fs.writeFileSync(target, mermaidScript)
          continue
        }
        const source = assetSource(assetRoot, relativePath)
        if (source === null) {
          throw new Error(`[umo-assets] 缺少外部资源 ${relativePath}`)
        }
        copyAsset(source, target)
      }
    },
  }
}
