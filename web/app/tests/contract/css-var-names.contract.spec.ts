/**
 * @fileoverview 契约：`var(--x)` 里那个名字得真有人写。
 *
 * ⚠ 这是一类**双双放行**的静默失效：CSS 变量名写错既不报错也不警告，浏览器只是
 * 当它没值——没有回落值时那条声明整条作废，于是「配了不生效」「这一档没上色」。
 * typecheck、lint、样式闸一个都拦不住，只有这里能拦（`--status-danger` 的教训，
 * 真名是 `--state-danger`）。
 * ⚠ 只查**没有回落值**的那一种：`var(--x, 兜底)` 是有意留的扩展点，没人写它是对的。
 * ⚠ 引用侧要先剥注释：`chrome.scss` 里正有一段注释在解释「刻意不写成
 * `var(--card-hover-glow)`」，不剥的话扫描器会把这句解释本身告上来。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()

/** 声明的来源：样式表、组件里的 style 块，以及运行时按字符串注入的那一路。 */
const DECL_EXTS = new Set(['.scss', '.css', '.vue', '.ts'])
/** 引用的来源：只有这两种里的 `var()` 会真的进浏览器。 */
const USE_EXTS = new Set(['.scss', '.css', '.vue'])

/** `--x:` 形式的声明。 */
const DECLARED = /(--[a-zA-Z0-9-]+)\s*:/g
/** `'--x'` 形式的声明：卡片外壳与画法那几路是在 TS 里按字符串注入的。 */
const DECLARED_IN_TS = /['"](--[a-zA-Z0-9-]+)['"]/g
/** 没有回落值的引用：`var(--x)` 直接收口。 */
const USED_BARE = /var\(\s*(--[a-zA-Z0-9-]+)\s*\)/g

/** 扫描下限：目录挪了位时上面那几段会对着空表报绿。 */
const MIN_DECLARED = 200
const MIN_USED = 100

function walk(dir: string, exts: ReadonlySet<string>): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, exts))
    else if (exts.has(extname(entry.name))) found.push(path)
  }
  return found
}

function matches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(([, name]) => name ?? '')
}

/** 块注释、行注释与 HTML 注释；⚠ `//` 前有冒号的是 URL，不是注释。 */
const COMMENTS = [
  /\/\*[\s\S]*?\*\//g,
  /(^|[^:])\/\/[^\n]*/g,
  /<!--[\s\S]*?-->/g,
]

/** 剥掉注释再找引用：注释里出现的名字是在讲它，不是在用它。 */
function stripComments(text: string): string {
  return COMMENTS.reduce(
    (out, pattern) =>
      out.replace(pattern, (_hit: string, head: unknown) =>
        typeof head === 'string' ? head : ' ',
      ),
    text,
  )
}

const SOURCE_DIRS = [
  join(WEB_ROOT, 'app', 'src'),
  ...readdirSync(join(WEB_ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(WEB_ROOT, 'packages', entry.name, 'src')),
]

/** 全仓写过的变量名。 */
const declared = new Set<string>()
for (const dir of SOURCE_DIRS) {
  for (const path of walk(dir, DECL_EXTS)) {
    const text = readFileSync(path, 'utf8')
    for (const name of matches(text, DECLARED)) declared.add(name)
    for (const name of matches(text, DECLARED_IN_TS)) declared.add(name)
  }
}

/** 没有回落值地引了谁，各在哪个文件。 */
const used = new Map<string, string>()
for (const dir of SOURCE_DIRS) {
  for (const path of walk(dir, USE_EXTS)) {
    const text = stripComments(readFileSync(path, 'utf8'))
    for (const name of matches(text, USED_BARE)) {
      if (!used.has(name)) used.set(name, path.slice(WEB_ROOT.length + 1))
    }
  }
}

describe('CSS 变量名', () => {
  it('扫得出东西来，别让下面那条对着空表报绿', () => {
    expect(declared.size).toBeGreaterThanOrEqual(MIN_DECLARED)
    expect(used.size).toBeGreaterThanOrEqual(MIN_USED)
  })

  // ⚠ 写错的名字没有回落值可退，那条声明整条作废：颜色不上、间距不生效，一声不吭
  it('不带回落值引的每一个名字都真有人写', () => {
    const stray = [...used]
      .filter(([name]) => !declared.has(name))
      .map(([name, path]) => `${name} ← ${path}`)

    expect(stray).toEqual([])
  })
})
