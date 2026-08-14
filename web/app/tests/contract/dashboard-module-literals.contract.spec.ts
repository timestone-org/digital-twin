/**
 * @fileoverview 锁住「运行时与编辑器里零模块类型字面量」（DASHBOARD_DESIGN §5.3 陷阱 ③）。
 *
 * ⚠ 有一处 `if (type === 'twin-view')` 就会有第二处，registry 当场失效：
 * 第三方写的模块参与不了任何按类型分支的能力。要区分能力时读 manifest 上的
 * 声明字段（`isContainer` / `region` / `chrome`），代码只读声明。
 * 这条只能靠 grep 兜：写进去既不报错也不失败，只是第三方模块永远少一半能力。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getModule, listModules, registerBuiltinModules } from '@dt/modules'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WEB_ROOT = process.cwd()

/** 要扫的目录：编辑器页面、大屏特性、运行态适配、启动装配，以及运行时包本身。 */
const SCANNED = [
  join(WEB_ROOT, 'app', 'src', 'pages', 'DashboardEditor'),
  join(WEB_ROOT, 'app', 'src', 'pages', 'DashboardView'),
  join(WEB_ROOT, 'app', 'src', 'pages', 'Home'),
  join(WEB_ROOT, 'app', 'src', 'features', 'dashboard'),
  join(WEB_ROOT, 'app', 'src', 'runtime'),
  join(WEB_ROOT, 'app', 'src', 'bootstrap'),
  join(WEB_ROOT, 'packages', 'runtime', 'src'),
]

/**
 * 编辑器单元里散落在通用目录下的那几份。
 * ⚠ 只点名这几个文件而不是整个 `composables/` 与 `api/`：别的页面用 `'header'`
 * 当插槽名或请求头名是正当的，整目录扫会把它们一起判红。
 */
const SCANNED_FILES = [
  join(WEB_ROOT, 'app', 'src', 'composables', 'useDashboardDoc.ts'),
  join(WEB_ROOT, 'app', 'src', 'composables', 'useDashboardEditor.ts'),
  join(WEB_ROOT, 'app', 'src', 'composables', 'useEditorHistory.ts'),
  join(WEB_ROOT, 'app', 'src', 'composables', 'usePointPicker.ts'),
  join(WEB_ROOT, 'app', 'src', 'composables', 'useDashboardValues.ts'),
  join(WEB_ROOT, 'app', 'src', 'api', 'dashboard.ts'),
  join(WEB_ROOT, 'app', 'src', 'api', 'dashboardWire.ts'),
]

registerBuiltinModules()

const MODULE_TYPES = listModules().map((manifest) => manifest.type)

function collectSources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectSources(full))
    else if (entry.endsWith('.vue') || entry.endsWith('.ts')) found.push(full)
  }
  return found
}

/** 去掉注释：文件头里提到模块类型是说明，不是分支。 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const SOURCES = [
  ...SCANNED.flatMap((dir) => collectSources(dir)),
  ...SCANNED_FILES,
]

// ⚠ `region === 'footer'` 用的是同一个字面量，但它是**区域**不是模块类型。
// 只放过紧跟在 region 比较/赋值后面的那一处，不是整行：按行放过的话，任何一行
// 只要提到 region 就能把同一行的模块类型判断一起夹带过闸
const REGION_QUALIFIED = /\bregion\b\s*(?:={1,3}|!==?|:)\s*$/

/** 一段源码里真正当模块类型用的那些字面量。 */
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

describe('模块类型字面量', () => {
  it('确实扫到了源码，也确实有已注册的模块类型', () => {
    expect(SOURCES.length).toBeGreaterThan(15)
    expect(MODULE_TYPES.length).toBeGreaterThan(0)
  })

  it('点名的那几份文件确实存在，路径没写错', () => {
    const missing = SCANNED_FILES.filter((path) => !statSync(path).isFile())

    expect(missing).toEqual([])
  })

  it('运行时与编辑器的源码里一个都不出现', () => {
    const offenders = SOURCES.flatMap((file) =>
      typeLiteralsIn(code(readFileSync(file, 'utf8')), MODULE_TYPES).map(
        (type) => `${type} @ ${file}`,
      ),
    )

    expect(offenders).toEqual([])
  })

  it('扫描器认得出真有字面量的那一行', () => {
    expect(
      typeLiteralsIn("if (node.moduleType === 'header') {", MODULE_TYPES),
    ).toEqual(['header'])
  })

  it('把字面量当区域值用的那一处放行', () => {
    expect(
      typeLiteralsIn("const y = manifest.region === 'footer' ? 1 : 0", [
        'footer',
      ]),
    ).toEqual([])
    expect(
      typeLiteralsIn("const pinned = { region: 'footer' }", ['footer']),
    ).toEqual([])
  })

  it('同一行里夹带的模块类型判断不跟着区域值一起放行', () => {
    expect(
      typeLiteralsIn(
        "if (m.region === 'footer' && node.moduleType === 'header') {",
        ['footer', 'header'],
      ),
    ).toEqual(['header'])
  })
})

describe('能力靠声明而不是靠类型', () => {
  it('内置模块各自声明了自己的能力，编辑器据此分支', () => {
    const container = listModules().filter(
      (manifest) => manifest.isContainer === true,
    )
    const pinned = listModules().filter(
      (manifest) => manifest.region !== undefined,
    )

    expect(container.length).toBeGreaterThan(0)
    expect(pinned.length).toBeGreaterThan(0)
  })

  it('注册表按 type 取得到清单，模块库因此不必认识具体类型', () => {
    for (const type of MODULE_TYPES) {
      expect(getModule(type)?.type).toBe(type)
    }
  })
})
