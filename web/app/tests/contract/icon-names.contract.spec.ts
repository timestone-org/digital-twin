/**
 * @fileoverview 锁住「转手传下去的图标名」也都登记过。
 *
 * ⚠ `packages/ui` 那份契约只扫得到 `<DtIcon name="...">`；`DtEmpty icon="…"`、
 * `DtButton icon="…"`、`DtMenuItem { icon: '…' }` 这些是**转发**给 DtIcon 的，
 * 到那边已经是 `:name="expr"` 的绑定，扫不出来。未登记的名字 DtIcon 静默不渲染，
 * typecheck 与 lint 双双放行——这个文件是它们唯一的防线。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isIconName } from '@dt/ui'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const APP_ROOT = join(process.cwd(), 'app', 'src')

// 模板里的 `icon="name"` 与对象字面量里的 `icon: 'name'`；绑定形式一概不扫
const ATTRIBUTE = /(?<![:\w-])icon="([a-z0-9-]+)"/g
const PROPERTY = /\bicon:\s*'([a-z0-9-]+)'/g

function collectSources(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...collectSources(full))
    else if (entry.endsWith('.vue') || entry.endsWith('.ts')) found.push(full)
  }
  return found
}

function usedIconNames(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = []
  for (const file of collectSources(APP_ROOT)) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of [ATTRIBUTE, PROPERTY]) {
      for (const match of source.matchAll(pattern)) {
        found.push({ name: match[1] ?? '', file })
      }
    }
  }
  return found
}

const USED = usedIconNames()

describe('转发给 DtIcon 的图标名', () => {
  it('确实扫到了（扫不到就等于这条闸没跑）', () => {
    expect(USED.length).toBeGreaterThan(10)
  })

  it('每一个都在注册表里', () => {
    const unregistered = USED.filter((item) => !isIconName(item.name)).map(
      (item) => `${item.name} @ ${item.file}`,
    )
    expect(unregistered).toEqual([])
  })
})
