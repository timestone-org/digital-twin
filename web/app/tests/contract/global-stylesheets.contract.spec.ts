/**
 * @fileoverview 契约：`@dt/*` 包对外导出的每一份 `.scss`，应用壳都真的引了——
 * 要么在 `styles/index.scss` 里 `@use`，要么在 `main.ts` 里 `import`。
 *
 * ⚠ 漏引一份是**零提示**的：包照常构建、组件照常挂载、全部单测照常绿，只有跑起来的
 * 界面上那一族观感整片不生效（`chrome.scss` 是大屏卡片的外框、`panel.scss` 是孪生信息
 * 牌的五种变体、`twin2d.scss` 是 2D 图的层序与底图）。谁也不会去查一句 `@use`。
 * ⚠ 这几份必须是**全局**的，不能改成组件里的 scoped：类名由数据挂上去（动画类、层类），
 * scoped 改写认不出这些名字，写成 scoped 的表现同样是「配了不生效」。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()
const PACKAGES = join(WEB_ROOT, 'packages')
const STYLE_ENTRY = join(WEB_ROOT, 'app', 'src', 'styles', 'index.scss')
const MAIN = join(WEB_ROOT, 'app', 'src', 'main.ts')

/** 导出份数下限：exports 改了形状时下面那段会静默扫出空表。 */
const MIN_SHEETS = 4

/** 一个包对外导出的 `.scss` 子路径。 */
interface Sheet {
  /** `@dt/twin2d/twin2d.scss` 这样的引用串。 */
  specifier: string
}

/** 每个包的 `exports` 里以 `.scss` 结尾的子路径。 */
function exportedSheets(): Sheet[] {
  const found: Sheet[] = []
  for (const name of readdirSync(PACKAGES)) {
    const manifest: unknown = JSON.parse(
      readFileSync(join(PACKAGES, name, 'package.json'), 'utf8'),
    )
    const exports =
      typeof manifest === 'object' && manifest !== null && 'exports' in manifest
        ? manifest.exports
        : undefined
    if (typeof exports !== 'object' || exports === null) continue
    for (const key of Object.keys(exports)) {
      if (!key.endsWith('.scss')) continue
      found.push({ specifier: `@dt/${name}/${key.replace('./', '')}` })
    }
  }
  return found
}

const SHEETS = exportedSheets()
const APP_ENTRIES = [STYLE_ENTRY, MAIN]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n')

describe('包导出的全局样式表都被应用壳引了', () => {
  it('扫得出导出来，别让扫描器对着空表报绿', () => {
    expect(SHEETS.length).toBeGreaterThanOrEqual(MIN_SHEETS)
    expect(SHEETS.map((sheet) => sheet.specifier)).toContain(
      '@dt/twin2d/twin2d.scss',
    )
  })

  it('每一份都在 index.scss 或 main.ts 里出现过', () => {
    const missing = SHEETS.filter(
      (sheet) => !APP_ENTRIES.includes(sheet.specifier),
    ).map((sheet) => sheet.specifier)

    expect(missing).toEqual([])
  })

  // ⚠ 装饰位图的 url() 只有走纯 CSS 才会被构建重写成带 hash 的产物路径，
  // 并进 index.scss 会被 Sass 内联掉、产物里留一条死路径
  it('装饰位图那一份单独走 main.ts，不并进 index.scss', () => {
    expect(readFileSync(MAIN, 'utf8')).toContain('@dt/tokens/decor.scss')
    expect(readFileSync(STYLE_ENTRY, 'utf8')).not.toContain('decor.scss')
  })

  // ⚠ 深链绕过 exports 那张表：包里挪一次目录，应用壳这一句当场断，而断法是构建期
  // 报一个找不到文件——比静默失效好，但那张表就白列了
  it('引的是包的公开子路径，不深链进包里的目录', () => {
    expect(APP_ENTRIES).not.toContain('@dt/tokens/src/')
    expect(APP_ENTRIES).not.toContain('@dt/twin2d/src/')
    expect(APP_ENTRIES).not.toContain('packages/')
  })
})
