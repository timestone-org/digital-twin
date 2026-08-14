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
  join(WEB_ROOT, 'app', 'src', 'pages', 'Dashboards'),
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
    const offenders: string[] = []
    for (const file of SOURCES) {
      const body = code(readFileSync(file, 'utf8'))
      for (const type of MODULE_TYPES) {
        for (const quote of ["'", '"', '`']) {
          if (body.includes(`${quote}${type}${quote}`)) {
            offenders.push(`${type} @ ${file}`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
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
