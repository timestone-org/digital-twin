/**
 * @fileoverview 守「运行时与编辑器里零模块类型字面量」：能力靠清单字段声明
 * （`region` / `isContainer` / `chrome`），代码只读声明。
 * ⚠ 一处 `type === 'twin-view'` 就意味着第三方模块永远拿不到那条能力，
 * 而注册表当场失效——这类判断编译期与 lint 都看不出问题（DASHBOARD_DESIGN §5.3 陷阱 ③）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import { registerBuiltinModules } from '../src/registerBuiltins'
import { __resetModules, listModules } from '../src/registry'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WEB_ROOT = process.cwd()

// 声明模块类型的地方只有各自的 manifest.ts，故本包的 src/modules 不在扫描范围内
// ⚠ 应用侧扫的是整个 `app/src` 而不是某个子目录：编辑器页面按本仓惯例会分居
// `pages/` 与 `features/`，只扫其一的话另一半里的 `=== 'twin-view'` 一个都拦不到
const ROOTS = [
  join(WEB_ROOT, 'packages', 'runtime', 'src'),
  join(WEB_ROOT, 'app', 'src'),
  join(WEB_ROOT, 'packages', 'modules', 'src'),
]
const EXCLUDED = join(WEB_ROOT, 'packages', 'modules', 'src', 'modules')

const SCRIPT_BLOCK = /<script[^>]*>(?<body>[\s\S]*?)<\/script>/g
// ⚠ `region === 'header'` 用的是同一个字面量，但它是**区域**不是模块类型。
// 只放过紧跟在 region 比较/赋值后面的那一处，不是整行：按行放过的话，
// 任何一行只要提到 region 就能把同一行的模块类型判断一起夹带过闸
const REGION_QUALIFIED = /\bregion\b\s*(?:={1,3}|!==?|:)\s*$/

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (path === EXCLUDED) return []
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.vue')
      ? [path]
      : []
  })
}

/** 只取脚本部分：模板里的 `class="header"` 与样式里的选择器不是类型判断。 */
function scriptOf(path: string, source: string): string {
  if (!path.endsWith('.vue')) return source
  return [...source.matchAll(SCRIPT_BLOCK)]
    .map((match) => match.groups?.body ?? '')
    .join('\n')
}

function typeLiteralsIn(source: string, types: readonly string[]): string[] {
  const found: string[] = []
  for (const line of source.split('\n')) {
    for (const type of types) {
      const quoted = new RegExp(`['"\`]${type}['"\`]`, 'g')
      for (const match of line.matchAll(quoted)) {
        const before = line.slice(0, match.index)
        if (REGION_QUALIFIED.exec(before) === null) found.push(type)
      }
    }
  }
  return found
}

let types: readonly string[] = []

beforeAll(() => {
  __resetModules()
  registerBuiltinModules()
  types = listModules().map((manifest) => manifest.type)
})

describe('模块类型字面量', () => {
  // ⚠ 逐个 root 断言而不是只看总数：目录改名后 `sourceFiles` 悄悄返回空数组，
  // 总数仍被别的 root 撑着为正，闸门于是变成一条永远绿的空转
  it('每个扫描根都真的扫到了文件，扫描本身没有空转', () => {
    const empty = ROOTS.filter((root) => sourceFiles(root).length === 0)

    expect(empty).toEqual([])
  })

  it('运行时、编辑器页面与本包的非清单代码里一处都没有', () => {
    const offenders = ROOTS.flatMap(sourceFiles).flatMap((path) =>
      typeLiteralsIn(scriptOf(path, readFileSync(path, 'utf8')), types).map(
        (type) => `${path}:${type}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('扫描器认得出真有字面量的那一行', () => {
    expect(
      typeLiteralsIn("if (node.moduleType === 'header') {", types),
    ).toEqual(['header'])
  })

  it('扫描器不把模板与样式里的同名字符串算进来', () => {
    const sfc = [
      '<template><div class="header" /></template>',
      '<script setup lang="ts">const a = 1</script>',
      '<style scoped>.header { color: red }</style>',
    ].join('\n')

    expect(typeLiteralsIn(scriptOf('X.vue', sfc), types)).toEqual([])
  })

  it('把字面量当区域值用的那一处放行', () => {
    expect(
      typeLiteralsIn("if (manifest.region === 'header') {", types),
    ).toEqual([])
    expect(
      typeLiteralsIn("const pinned = { region: 'header' }", types),
    ).toEqual([])
  })

  it('同一行里夹带的模块类型判断不跟着区域值一起放行', () => {
    expect(
      typeLiteralsIn(
        "if (m.region === 'header' && node.moduleType === 'twin-view') {",
        types,
      ),
    ).toEqual(['twin-view'])
  })
})
