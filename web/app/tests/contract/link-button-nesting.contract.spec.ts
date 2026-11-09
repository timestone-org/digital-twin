/**
 * @fileoverview 锁住「按钮不许套在链接里」：`<RouterLink>` 默认渲染成 `<a>`，里面再放
 * 按钮就是 `<a><button>`，交互元素嵌套不合法，读屏与键盘焦点会落两次。
 * ⚠ 要跳转的按钮用 `custom` 插槽拿 `navigate` 自己导航。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const SRC = join(process.cwd(), 'app', 'src')

const LINK = /<RouterLink\b([^>]*)>([\s\S]*?)<\/RouterLink>/g
const BUTTON = /<(DtButton|DtIconButton|button)\b/

function vueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...vueFiles(full))
    else if (entry.endsWith('.vue')) found.push(full)
  }
  return found
}

function nestedButtons(source: string): number {
  let count = 0
  for (const match of source.matchAll(LINK)) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    if (!/\bcustom\b/.test(attrs) && BUTTON.test(body)) count += 1
  }
  return count
}

describe('链接里不套按钮', () => {
  it('非 custom 的 RouterLink 里没有按钮', () => {
    const offenders = vueFiles(SRC)
      .filter((file) => nestedButtons(readFileSync(file, 'utf8')) > 0)
      .map((file) => relative(SRC, file))
    expect(offenders).toEqual([])
  })

  it('判据本身认得出嵌套', () => {
    expect(
      nestedButtons('<RouterLink to="/a"><DtButton>去</DtButton></RouterLink>'),
    ).toBe(1)
    expect(
      nestedButtons(
        '<RouterLink v-slot="{ navigate }" to="/a" custom><DtButton @click="navigate">去</DtButton></RouterLink>',
      ),
    ).toBe(0)
  })
})
