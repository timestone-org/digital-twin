/**
 * @fileoverview 锁住「多字段弹窗必须防误关」这条口径。
 *
 * ⚠ 这条只能靠扫源码守：漏传 `:dirty` 没有任何类型错误，弹窗照常能用，只是
 * 保护安静地不存在——直到某天有人填了十几个字段、手一滑点在遮罩上。
 * ⚠ 门槛定在**两个以上文本输入**：单字段的动作弹窗（重置密码、写值、改名）
 * 重填一次的代价很低，每个都拦反而是打扰。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const PAGES = join(process.cwd(), 'app', 'src', 'pages')

/** 会让人「填进去」的控件。下拉与开关不算：它们重选一次就是一下。 */
const TEXT_INPUT = /<Dt(Input|Textarea|NumberInput)\b/g
const MIN_FIELDS = 2

/**
 * 有意不装的弹窗，每条都要有理由。
 * ⚠ 名单只进不出地长下去就等于没有这条闸——加一条之前先想清楚，
 * 用户在那个弹窗里填的东西是不是真的不值钱。
 */
const EXEMPT = new Map<string, string>([
  [
    'AcDataDialog.vue',
    '它是「看数」弹窗：里面的输入是查询条件，关掉重开一次就是了',
  ],
])

function collectDialogs(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectDialogs(full))
      continue
    }
    if (entry.endsWith('Dialog.vue')) found.push(full)
  }
  return found
}

function fieldCount(source: string): number {
  return source.match(TEXT_INPUT)?.length ?? 0
}

describe('多字段弹窗必须防误关', () => {
  it('凡是有两个以上输入的弹窗都把 dirty 传给了 DtModal', () => {
    const missing = collectDialogs(PAGES).filter((path) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      if (EXEMPT.has(name)) return false
      const source = readFileSync(path, 'utf8')
      if (!source.includes('<DtModal')) return false
      if (fieldCount(source) < MIN_FIELDS) return false
      return !source.includes(':dirty=')
    })

    expect(missing.map((path) => path.slice(PAGES.length + 1))).toEqual([])
  })

  it('豁免名单里的每一条都写了理由，且文件还在', () => {
    const names = collectDialogs(PAGES).map((path) =>
      path.slice(path.lastIndexOf('/') + 1),
    )
    for (const [name, reason] of EXEMPT) {
      expect(names).toContain(name)
      expect(reason.length).toBeGreaterThan(10)
    }
  })
})
