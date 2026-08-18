/**
 * @fileoverview 锁住「带筛选的列表必须分两种空」这条口径。
 *
 * ⚠ 合成一种会造出一条**让人做错事**的引导：点位表在搜不到时说「去浏览树里
 * 勾选导入」，工程师真的会再导一遍；空调台账说「先去空间配置建车间」，而车间
 * 早就建好了。
 * ⚠ 判据是「`:empty` 不许写死」，而不是「文件里得出现某个函数名」：空态算在
 * 哪儿是各页自己的事（点位表就放在 `usePointList` 里），钉死写法只会逼人
 * 把逻辑搬回组件里。完全不给 `:empty` 同样不行——那会两种情况都落到
 * `DtDataView` 那句通用的「暂无数据」上。
 * ⚠ 只扫「有筛选」的列表：没有筛选的列表空了就是真空了，一句引导正合适。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const PAGES = join(process.cwd(), 'app', 'src', 'pages')

/** 页面上有没有「筛」这件事：关键词框、搜索框，或一组筛选条件。 */
const FILTER_SIGNALS = [
  /\bkeyword\b/,
  /type="search"/,
  /placeholder="搜索/,
  /\bfilters\./,
]

/**
 * 有意不装的列表，每条都要有理由。
 * ⚠ 名单只进不出地长下去就等于没有这条闸。
 */
const EXEMPT = new Map<string, string>()

function collectViews(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectViews(full))
      continue
    }
    if (entry.endsWith('.vue')) found.push(full)
  }
  return found
}

function hasFilter(source: string): boolean {
  return FILTER_SIGNALS.some((pattern) => pattern.test(source))
}

describe('带筛选的列表必须分两种空', () => {
  it('凡是能筛的列表都按筛选状态给空态，而不是写死一句', () => {
    const missing = collectViews(PAGES).filter((path) => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      if (EXEMPT.has(name)) return false
      const source = readFileSync(path, 'utf8')
      if (!source.includes('<DtDataView')) return false
      if (!hasFilter(source)) return false
      // 写死一个对象字面量，或压根不给——两种都是「只有一种空」
      return /:empty="\{/.test(source) || !source.includes(':empty=')
    })

    expect(missing.map((path) => path.slice(PAGES.length + 1))).toEqual([])
  })
})
