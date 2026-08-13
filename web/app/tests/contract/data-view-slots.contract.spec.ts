/**
 * @fileoverview 锁住「列定义 ↔ 单元格插槽」一一对应。
 *
 * ⚠ 这是 DtTable / DtDataView 唯一的防线。插槽名写错（`#cell-lastLogin` 打成
 * `#cell-lastlogin`）**typecheck 与 lint 双双放行**：多出来的插槽 Vue 直接忽略，
 * 缺掉的那一列静静渲染成 `—`。页面看着还在，只是那一列永远没数据。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const PAGES_ROOT = join(process.cwd(), 'app', 'src')

const COLUMN_KEY = /\bkey:\s*'([A-Za-z0-9_]+)'/g
const SLOT_NAME = /#cell-([A-Za-z0-9_]+)=/g

function collectVueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectVueFiles(full))
    else if (entry.endsWith('.vue')) found.push(full)
  }
  return found
}

/**
 * 取一个文件里全部列定义，按方括号配对切出来拼在一起。
 *
 * ⚠ 起点要从 `=` 之后找，不能从 `const` 之后找：类型标注里的
 * `DtDataColumn[]` 会先撞上，切出来是个空数组，闸就永远绿。
 * ⚠ 认 `XXX_COLUMNS` 而不只是 `COLUMNS`：一个文件里摆两张表时，两个常量
 * 不可能都叫 `COLUMNS`，只认后者等于放过了这类文件（安全面板就是）。
 */
function columnsBlock(source: string): string | null {
  const declaration = /const [A-Z_]*COLUMNS\b[^=]*=\s*\[/g
  const blocks: string[] = []
  for (const match of source.matchAll(declaration)) {
    const open = source.indexOf('[', match.index + match[0].length - 1)
    let depth = 0
    for (let index = open; index < source.length; index += 1) {
      const char = source[index]
      if (char === '[') depth += 1
      else if (char === ']') {
        depth -= 1
        if (depth === 0) {
          blocks.push(source.slice(open, index + 1))
          break
        }
      }
    }
  }
  return blocks.length > 0 ? blocks.join('\n') : null
}

interface Usage {
  file: string
  columns: string[]
  slots: string[]
}

function usages(): Usage[] {
  const found: Usage[] = []
  for (const file of collectVueFiles(PAGES_ROOT)) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('<DtDataView') && !source.includes('<DtTable'))
      continue
    const block = columnsBlock(source)
    if (block === null) continue
    found.push({
      file,
      columns: [...block.matchAll(COLUMN_KEY)].map((m) => m[1] ?? ''),
      slots: [...source.matchAll(SLOT_NAME)].map((m) => m[1] ?? ''),
    })
  }
  return found
}

const USAGES = usages()

describe('列定义与单元格插槽', () => {
  it('确实扫到了用到表格的页面（扫不到就等于这条闸没跑）', () => {
    expect(USAGES.length).toBeGreaterThanOrEqual(4)
  })

  it.each(USAGES.map((u) => [u.file, u] as const))(
    '%s 的插槽名都对得上某一列',
    (_file, usage) => {
      const unknown = usage.slots.filter((s) => !usage.columns.includes(s))
      expect(unknown).toEqual([])
    },
  )

  it.each(USAGES.map((u) => [u.file, u] as const))(
    '%s 的每一列都有插槽，不会静静渲染成占位符',
    (_file, usage) => {
      const missing = usage.columns.filter((c) => !usage.slots.includes(c))
      expect(missing).toEqual([])
    },
  )
})
