/**
 * @fileoverview 契约：2D 孪生的编辑器与运行态共用同一份画法——标注的形状件、底图与
 * 图案底的求值、以及消费那两个自定义属性的 CSS 规则，全仓各只有一处，都在 `@dt/twin2d`。
 *
 * ⚠ 这一类漂移是零提示的：编辑器另写一份标注形状，同一条标注在编辑器里画一个样、上了
 * 大屏画另一个样；另算一份底图，则底图偏一点、图案疏一格——而两边**单看都对**，
 * typecheck、eslint 与各自的单测一律放行。所见即所得只能靠这条契约钉住。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()
const EDITOR_DIR = join(WEB_ROOT, 'app', 'src', 'pages', 'Twin2dEditor')
const PKG_SRC = join(WEB_ROOT, 'packages', 'twin2d', 'src')
const SCSS = join(PKG_SRC, 'render', 'twin2d.scss')

/** 编辑器页的源码份数下限：目录改名或后缀变了，扫描器本来会静默空转。 */
const MIN_EDITOR_FILES = 30

/**
 * 只该出现在包里的记号。
 * ⚠ 判据是**记号**不是文件名：把同一段画法抄进另一个文件、换个组件名，靠文件清单
 * 一条都拦不住。
 */
const PACKAGE_ONLY: readonly { what: string; token: string }[] = [
  { what: '标注形状', token: 'data-test="mark-shape"' },
  { what: '标注标签', token: 'data-test="mark-label"' },
  { what: '底图取值', token: '--t2-bg' },
  { what: '图案取值', token: '--t2-pattern' },
  { what: '底图的四档铺法', token: 'no-repeat' },
]

/**
 * 一个目录下的源码文件，递归。
 * @param dir 目录
 */
function sourcesIn(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...sourcesIn(full))
      continue
    }
    if (entry.endsWith('.ts') || entry.endsWith('.vue')) found.push(full)
  }
  return found
}

/** 去掉注释：注释里提到一个记号不等于写了它。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(?:\/\/|\/\/\/).*$/gm, '')
}

const EDITOR_FILES = sourcesIn(EDITOR_DIR)
const EDITOR_SOURCE = EDITOR_FILES.map((file) =>
  stripComments(readFileSync(file, 'utf8')),
).join('\n')

/**
 * 编辑器某个文件的源码。
 * @param name 文件名
 */
function editorFile(name: string): string {
  const path = EDITOR_FILES.find((file) => file.endsWith(name))
  if (path === undefined) throw new Error(`编辑器里没有 ${name}`)
  return readFileSync(path, 'utf8')
}

describe('编辑器与运行态共用一份画法', () => {
  it('扫到了编辑器的源码，别让扫描器对着空表报绿', () => {
    expect(EDITOR_FILES.length).toBeGreaterThan(MIN_EDITOR_FILES)
    expect(EDITOR_SOURCE).toContain('CanvasMarkLayer')
  })

  it('只属于包里的那几个记号，编辑器一处都不写', () => {
    const copied = PACKAGE_ONLY.filter((item) =>
      EDITOR_SOURCE.includes(item.token),
    ).map((item) => item.what)

    expect(copied).toEqual([])
  })

  it('那几个记号在包里确实还在，没有跟着改名', () => {
    const source = sourcesIn(PKG_SRC)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')
    const missing = PACKAGE_ONLY.filter(
      (item) => !source.includes(item.token),
    ).map((item) => item.what)

    expect(missing).toEqual([])
  })

  it('编辑器的标注层挂的是包里那一份形状件', () => {
    expect(editorFile('CanvasMarkLayer.vue')).toContain(
      "import { Twin2dMarkShape } from '@dt/twin2d'",
    )
  })

  it('编辑画布调的是包里那一份底两层求值', () => {
    expect(editorFile('CanvasGrid.vue')).toContain('canvasBackdropStyles')
  })

  // ⚠ 求值共用了、消费那两个属性的规则却各写一份的话，同样会漂
  it('消费那两个属性的规则只在包的样式表里，两个宿主挂同一对类名', () => {
    const scss = readFileSync(SCSS, 'utf8')

    expect(scss).toContain('.t2-backdrop {')
    expect(scss).toContain('.t2-backdrop-pattern {')
    expect(editorFile('CanvasGrid.vue')).toContain('t2-backdrop-pattern')
    expect(
      readFileSync(join(PKG_SRC, 'render', 'Twin2dStage.vue'), 'utf8'),
    ).toContain('t2-backdrop-pattern')
  })
})
