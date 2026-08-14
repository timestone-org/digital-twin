/**
 * @fileoverview 锁住「启动图里没有 three」：`@dt/three-core` 的桶文件第一行就静态
 * 依赖整个 three，启动期代码一旦从桶进来，首屏 chunk 就会被撑破预算
 * （`scripts/gates/check_bundle_budget.py` 的 HEAVY 名单）。注入接缝走深路径
 * `@dt/three-core/host`，渲染组件由模块清单异步 import。
 *
 * ⚠ 这条只跟着**静态** import 走：动态 `import()` 会被打成独立 chunk，正是要的形态。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WEB_ROOT = process.cwd()
const ENTRY = join(WEB_ROOT, 'app', 'src', 'main.ts')
const APP_SRC = join(WEB_ROOT, 'app', 'src')
const PACKAGES = join(WEB_ROOT, 'packages')

// `import ... from '…'` / `export ... from '…'`，`import type` 不算（编译后被完全擦除）
const FROM_CLAUSE =
  /(?:^|\n)\s*(?:import|export)(?<clause>[\s\S]*?)\bfrom\s*['"](?<target>[^'"]+)['"]/g
const SIDE_EFFECT = /(?:^|\n)\s*import\s*['"](?<target>[^'"]+)['"]/g
const FOLLOWED_SUFFIXES = ['', '.ts', '.vue', '/index.ts', '/index.vue']
const SOURCE_SUFFIXES = ['.ts', '.vue']

function readIfFile(path: string): string | null {
  return existsSync(path) && statSync(path).isFile()
    ? readFileSync(path, 'utf8')
    : null
}

function resolveFile(base: string): string | null {
  for (const suffix of FOLLOWED_SUFFIXES) {
    const candidate = base + suffix
    if (
      SOURCE_SUFFIXES.some((extension) => candidate.endsWith(extension)) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      return candidate
    }
  }
  return null
}

/** package.json 的 exports 表，只收「子路径 → 单个文件」这一种形状。 */
function exportsOf(manifest: string): Record<string, string> {
  const parsed: unknown = JSON.parse(manifest)
  if (typeof parsed !== 'object' || parsed === null) return {}
  if (!('exports' in parsed)) return {}
  const table = parsed.exports
  if (typeof table !== 'object' || table === null) return {}
  const found: Record<string, string> = {}
  for (const key of Object.keys(table)) {
    const target = Reflect.get(table, key) as unknown
    if (typeof target === 'string') found[key] = target
  }
  return found
}

/** `@dt/<包>` / `@dt/<包>/<子路径>` → 包内源文件，按 package.json 的 exports 走。 */
function resolvePackage(specifier: string): string | null {
  const [, name, subpath] =
    /^@dt\/([a-z0-9-]+)(?:\/(.+))?$/.exec(specifier) ?? []
  if (name === undefined) return null
  const root = join(PACKAGES, name)
  const manifest = readIfFile(join(root, 'package.json'))
  if (manifest === null) return null
  const target =
    exportsOf(manifest)[subpath === undefined ? '.' : `./${subpath}`]
  if (target !== undefined) return resolveFile(join(root, target))
  return subpath === undefined ? resolveFile(join(root, 'src', 'index')) : null
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  if (specifier.startsWith('.')) {
    return resolveFile(resolve(dirname(fromFile), specifier))
  }
  if (specifier.startsWith('@/')) {
    return resolveFile(join(APP_SRC, specifier.slice(2)))
  }
  return resolvePackage(specifier)
}

function specifiersOf(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(FROM_CLAUSE)) {
    if ((match.groups?.clause ?? '').trim().startsWith('type ')) continue
    found.push(match.groups?.target ?? '')
  }
  for (const match of source.matchAll(SIDE_EFFECT)) {
    found.push(match.groups?.target ?? '')
  }
  return found
}

interface StartupGraph {
  files: string[]
  external: string[]
}

function crawl(entry: string): StartupGraph {
  const files = new Set<string>()
  const external = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined || files.has(current)) continue
    files.add(current)
    const source = readIfFile(current)
    if (source === null) continue
    for (const specifier of specifiersOf(source)) {
      const resolved = resolveSpecifier(specifier, current)
      if (resolved === null) external.add(specifier)
      else queue.push(resolved)
    }
  }
  return { files: [...files], external: [...external] }
}

const graph = crawl(ENTRY)

describe('应用壳的启动图', () => {
  it('爬到了入口之外的真实模块，爬虫本身没有空转', () => {
    expect(graph.files).toContain(ENTRY)
    expect(graph.files).toContain(join(APP_SRC, 'App.vue'))
    expect(graph.files.length).toBeGreaterThan(20)
    expect(graph.external).toContain('vue')
  })

  it('静态依赖里没有 three', () => {
    const heavy = graph.external.filter(
      (specifier) => specifier === 'three' || specifier.startsWith('three/'),
    )

    expect(heavy).toEqual([])
  })

  it('没有任何文件从 @dt/three-core 的桶文件进来', () => {
    const barrel = graph.files.filter((path) =>
      path.startsWith(join(PACKAGES, 'three-core', 'src')),
    )
    const allowed = join(PACKAGES, 'three-core', 'src', 'host.ts')

    expect(barrel.filter((path) => path !== allowed)).toEqual([])
  })
})
