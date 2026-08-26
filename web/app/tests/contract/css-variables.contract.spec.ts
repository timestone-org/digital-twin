/**
 * @fileoverview 样式里用到的每个 `var(--…)` 都必须真的有人定义。
 *
 * ⚠ 这条闸补的是一个**全无提示**的洞：CSS 里 `var(--typo)` 解析不到就静默
 * 什么都不画——背景不出现、颜色不变、间距为零，而 typecheck、eslint、
 * stylelint、全部单测一律放行，构建也照常成功。只有人眼盯着那一处才看得见。
 *
 * 真实案例：节点树的 hover 与选中态写的是 `--surface-hover` / `--surface-active`，
 * 而主题引擎注入的只有 base/sunken/panel/raised/overlay 五个 —— 那两个从来
 * 没有被定义过，于是**选中一行没有任何视觉反馈**，而所有检查都是绿的。
 *
 * 真源有两处：主题引擎注入的（随主题变），与 `tokens.scss` 里静态声明的
 * （不随主题变，如圆角与阴影）。两处都算数，其余一律视为拼错。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TOKEN_CSS_VAR } from '@dt/tokens'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()
const SCAN_ROOTS = [
  join(WEB_ROOT, 'app', 'src'),
  join(WEB_ROOT, 'packages', 'ui', 'src'),
]
const TOKENS_SCSS = join(WEB_ROOT, 'packages', 'tokens', 'src', 'tokens.scss')
const STYLE_SUFFIXES = ['.vue', '.scss', '.css', '.ts']

/**
 * `var(--foo)` 与 `var(--foo, fallback)` 都取变量名。
 * ⚠ 第二组捕获 SCSS 插值：`var(--ctl-h-#{$size})` 的变量名要到运行时才拼得出来，
 * 静态扫不出全名，这类一律跳过而不是误判成拼错。
 */
const USAGE = /var\(\s*(--[a-z0-9-]+)(#\{)?/gi
/**
 * `--foo: value` 形式的声明。不锚定行首——`style="--i: 1"` 这种行内声明
 * 同样算数；前面不许紧跟 `(`，那是 `var(--foo)` 的形状不是声明。
 */
const DECLARATION = /(?<![\w(-])(--[a-z0-9-]+)\s*:/g
/**
 * `'--foo': value` 形式的声明（模板里的 `:style` 对象绑定）。
 * ⚠ 少了这条会把内联样式设的变量全判成拼错——主题预览块就是这么设的。
 */
const BOUND_DECLARATION = /['"](--[a-z0-9-]+)['"]\s*:/g

function walk(root: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) {
      found.push(...walk(path))
    } else if (STYLE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) {
      found.push(path)
    }
  }
  return found
}

function declaredNames(): Set<string> {
  const declared = new Set<string>(Object.values(TOKEN_CSS_VAR))
  collectDeclarations(readFileSync(TOKENS_SCSS, 'utf8'), declared)
  // 组件自己在 `:root` 之外声明的局部变量同样算数：扫到哪个文件就把它
  // 自己的声明一并收进来，避免把「局部变量」误判成拼错。
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      collectDeclarations(readFileSync(file, 'utf8'), declared)
    }
  }
  return declared
}

/**
 * ⚠ 注释要先剥掉再扫用法：`color.ts` 的文档里写着 `var(--token)` 举例，
 * 那是说明不是用法，不剥就会把示例判成拼错。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function collectDeclarations(source: string, into: Set<string>): void {
  for (const pattern of [DECLARATION, BOUND_DECLARATION]) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1]
      if (name !== undefined) into.add(name)
    }
  }
}

describe('样式里的 CSS 变量', () => {
  it('扫到了源文件', () => {
    expect(SCAN_ROOTS.flatMap(walk).length).toBeGreaterThan(50)
  })

  it('每个 var(--…) 都有定义处', () => {
    const declared = declaredNames()
    const unknown: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of walk(root)) {
        const source = stripComments(readFileSync(file, 'utf8'))
        for (const match of source.matchAll(USAGE)) {
          const name = match[1]
          const interpolated = match[2] !== undefined
          if (name === undefined || interpolated || declared.has(name)) continue
          unknown.push(`${file.replace(WEB_ROOT, '')} → ${name}`)
        }
      }
    }
    expect(unknown).toEqual([])
  })
})
