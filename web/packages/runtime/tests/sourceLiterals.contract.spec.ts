/**
 * @fileoverview 守运行时的两条「无感知」：源码里**没有任何模块类型字面量**
 * （能力读清单的声明字段），也**没有任何来源种类字面量**（派生槽靠 `computeJson`
 * 认出来，取数一律走注入的读取器）。
 * ⚠ 一处 `moduleType === 'twin-view'` 就意味着第三方模块永远拿不到那条能力，
 * 一处 `sourceKind === 'opcua'` 就意味着加一种来源要回来改渲染层——
 * 这两类判断 typecheck 与 lint 双双放行（DASHBOARD_DESIGN §5.3 陷阱 ③、§5.5）。
 */
import { BINDING_SOURCE_KINDS } from '@dt/contracts'
import {
  __resetModules,
  listModules,
  registerBuiltinModules,
} from '@dt/modules'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const RUNTIME_SRC = join(process.cwd(), 'packages', 'runtime', 'src')

const SCRIPT_BLOCK = /<script[^>]*>(?<body>[\s\S]*?)<\/script>/g

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.vue')
      ? [path]
      : []
  })
}

/** 只取脚本部分：模板里的 class 名与样式里的选择器不是判断。 */
function scriptOf(path: string, source: string): string {
  if (!path.endsWith('.vue')) return source
  return [...source.matchAll(SCRIPT_BLOCK)]
    .map((match) => match.groups?.body ?? '')
    .join('\n')
}

function quotedIn(source: string, words: readonly string[]): string[] {
  return words.filter(
    (word) => new RegExp(`['"\`]${word}['"\`]`).exec(source) !== null,
  )
}

function offenders(words: readonly string[]): string[] {
  return sourceFiles(RUNTIME_SRC).flatMap((path) =>
    quotedIn(scriptOf(path, readFileSync(path, 'utf8')), words).map(
      (word) => `${path}:${word}`,
    ),
  )
}

let moduleTypes: readonly string[] = []

beforeAll(() => {
  __resetModules()
  registerBuiltinModules()
  moduleTypes = listModules().map((manifest) => manifest.type)
})

afterAll(() => {
  __resetModules()
})

describe('扫描器本身', () => {
  it('扫到的源文件不是空的，扫描没有空转', () => {
    expect(sourceFiles(RUNTIME_SRC).length).toBeGreaterThan(0)
  })

  it('认得出真有字面量的那一行', () => {
    expect(quotedIn("if (node.moduleType === 'header') {", ['header'])).toEqual(
      ['header'],
    )
  })

  it('不把模板与样式里的同名字符串算进来', () => {
    const sfc = [
      '<template><div class="header" /></template>',
      '<script setup lang="ts">const a = 1</script>',
      '<style scoped>.header { color: red }</style>',
    ].join('\n')

    expect(quotedIn(scriptOf('X.vue', sfc), ['header'])).toEqual([])
  })
})

describe('运行时的无感知', () => {
  it('已注册的模块类型一个都没出现在运行时源码里', () => {
    expect(offenders(moduleTypes)).toEqual([])
  })

  it('绑定来源种类一个都没出现在运行时源码里', () => {
    expect(offenders(BINDING_SOURCE_KINDS)).toEqual([])
  })
})
