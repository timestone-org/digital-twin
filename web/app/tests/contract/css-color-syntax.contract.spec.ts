/**
 * @fileoverview 契约：`--x-rgb` 那一族令牌是**逗号三元组**，只能配 `rgba(var(--x), α)`。
 *
 * ⚠ 这是两道 CSS 变量闸都逮不到的一类：变量名完全正确，错的是外层函数语法。
 * `--accent-primary-rgb` 展开成 `0, 206, 252`，写成 `rgb(var(--accent-primary-rgb) / 0.7)`
 * 就是 `rgb(0, 206, 252 / 0.7)`——非法 CSS，**整条声明作废**：`fill` 回落成黑、
 * `background` 干脆整条不画（设计规格 D-1）。
 * ⚠ 扫的两个根目录都在 `src` 下，本用例自己不在扫描范围内，正则不会自证。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()

/** 只有这三种里的颜色函数会真的进浏览器。 */
const STYLE_EXTS = new Set(['.scss', '.css', '.vue'])

/** 非法：逗号三元组的令牌配上了斜杠 alpha。 */
const SLASH_ALPHA = /\brgba?\(\s*var\(\s*--[a-zA-Z0-9-]+\s*\)\s*\//
/** 合法且遍地都是的那一种，用来给下面的扫描下限做锚。 */
const COMMA_ALPHA = /\brgba\(\s*var\(\s*--[a-zA-Z0-9-]+\s*\)\s*,/g

/** 扫描下限：目录挪了位时下面那条会对着空表报绿。 */
const MIN_LEGAL = 50

/** 块注释、行注释与 HTML 注释；⚠ `//` 前有冒号的是 URL，不是注释。 */
const COMMENTS = [
  /\/\*[\s\S]*?\*\//g,
  /(^|[^:])\/\/[^\n]*/g,
  /<!--[\s\S]*?-->/g,
]

/** 抹掉一段注释，但把它占的行数留下——报出来的行号才对得上文件。 */
function blankOut(hit: string, head: unknown): string {
  const lead = typeof head === 'string' && head !== '\n' ? head : ''
  const breaks = (hit.match(/\n/g) ?? []).length
  return lead + (breaks > 0 ? '\n'.repeat(breaks) : ' ')
}

/** 剥掉注释再扫：注释里写出这个形状是在讲它，不是在用它。 */
function stripComments(text: string): string {
  return COMMENTS.reduce((out, pattern) => out.replace(pattern, blankOut), text)
}

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path))
    else if (STYLE_EXTS.has(extname(entry.name))) found.push(path)
  }
  return found
}

const SOURCE_DIRS = [
  join(WEB_ROOT, 'app', 'src'),
  ...readdirSync(join(WEB_ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(WEB_ROOT, 'packages', entry.name, 'src')),
]

const illegal: string[] = []
let legalCount = 0
for (const dir of SOURCE_DIRS) {
  for (const path of walk(dir)) {
    const text = stripComments(readFileSync(path, 'utf8'))
    const where = path.slice(WEB_ROOT.length + 1)
    text.split('\n').forEach((line, at) => {
      if (SLASH_ALPHA.test(line)) illegal.push(`${where}:${at + 1}`)
    })
    legalCount += [...text.matchAll(COMMA_ALPHA)].length
  }
}

describe('颜色函数的语法', () => {
  it('扫得出东西来，别让下面那条对着空表报绿', () => {
    expect(legalCount).toBeGreaterThanOrEqual(MIN_LEGAL)
  })

  // ⚠ 非法的那条声明整条作废：点与柱回落成黑，背景色干脆不画，一声不吭
  it('逗号三元组的令牌只配 rgba(var(--x), α)，不许配斜杠 alpha', () => {
    expect(illegal).toEqual([])
  })
})
