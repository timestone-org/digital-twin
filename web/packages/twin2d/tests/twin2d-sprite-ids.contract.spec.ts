/**
 * @fileoverview 契约：三份 sprite 常量与 `src/render/icons.svg` 这份文件本身对齐。
 *
 * ⚠ 三条都是两头零报错的静默失效：id 名单多一个 → 那一档永远渲染空白，少一个 →
 * 用户永远选不到；固定色名单少一个 → 那枚多色图标的颜色控件可点、点了没反应，
 * 多一个 → 一枚本可染色的被白白禁掉；渐变前缀撞上文档级 id → 同页另一张图的
 * 填充被悄悄换掉（见 MODULE_TWIN_2D_DESIGN.md §5）。
 * ⚠ 期望值一律从 icons.svg 现场解析，不许手抄成清单——手抄的清单漂了，契约就是假的。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_FIXED_COLOR_SPRITES,
  TWIN_2D_SPRITE_GRADIENT_IDS,
  TWIN_2D_SPRITE_IDS,
} from '../src/kinds'
import { svgGradientDomId } from '../src/paintVec'

/** ⚠ 从 `process.cwd()`（web workspace 根）拼路径：happy-dom 那一趟里
 *  `import.meta.url` 不是 `file:` 协议，`fileURLToPath` 会当场抛。 */
const SPRITE_SVG = readFileSync(
  join(process.cwd(), 'packages', 'twin2d', 'src', 'render', 'icons.svg'),
  'utf8',
)

/** 逐个 `<symbol>` 连同它的内容。 */
const SYMBOL_RE = /<symbol\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g
/**
 * 硬编码色值。
 * ⚠ 后面那个否定环视是必需的：`url(#hxFill)` 与 `href="#ico-tap"` 也以 `#` 开头，
 * 少了它，纯 `currentColor` 的那 7 枚会被误判成多色。
 */
const HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})(?![0-9a-zA-Z_-])/g
/** 文档级渐变定义。 */
const GRADIENT_RE = /<(?:linear|radial)Gradient\b[^>]*\bid="([^"]+)"/g

/** 文件里每个 symbol 的 id 与它内部的硬编码色值个数。 */
function symbolsInFile(): { id: string; hexCount: number }[] {
  return [...SPRITE_SVG.matchAll(SYMBOL_RE)].map((match) => ({
    id: match[1] ?? '',
    hexCount: (match[2] ?? '').match(HEX_RE)?.length ?? 0,
  }))
}

/** 文件里所有渐变定义的 id。 */
function gradientIdsInFile(): string[] {
  return [...SPRITE_SVG.matchAll(GRADIENT_RE)].map((match) => match[1] ?? '')
}

describe('TWIN_2D_SPRITE_IDS ↔ icons.svg', () => {
  it('常量与文件里的 symbol id 双向逐项相等', () => {
    const inFile = symbolsInFile().map((symbol) => symbol.id)

    expect([...TWIN_2D_SPRITE_IDS].sort()).toEqual([...inFile].sort())
  })

  it('文件里 symbol id 不重复——重了后一枚会悄悄盖掉前一枚', () => {
    const inFile = symbolsInFile().map((symbol) => symbol.id)

    expect(new Set(inFile).size).toBe(inFile.length)
  })
})

describe('TWIN_2D_FIXED_COLOR_SPRITES ↔ icons.svg', () => {
  it('名单逐项等于文件里「硬编码色值 > 0」的那批 symbol', () => {
    const colored = symbolsInFile()
      .filter((symbol) => symbol.hexCount > 0)
      .map((symbol) => symbol.id)

    expect([...TWIN_2D_FIXED_COLOR_SPRITES].sort()).toEqual([...colored].sort())
  })

  it('名单外的每一枚都一个硬编码色值都没有，才吃得住 ico.color', () => {
    const fixed = new Set<string>(TWIN_2D_FIXED_COLOR_SPRITES)
    const tintable = symbolsInFile().filter((symbol) => !fixed.has(symbol.id))

    expect(tintable.map((symbol) => [symbol.id, symbol.hexCount])).toEqual(
      tintable.map((symbol) => [symbol.id, 0]),
    )
  })
})

describe('局部渐变的实例前缀 ↔ icons.svg 的文档级渐变', () => {
  it('TWIN_2D_SPRITE_GRADIENT_IDS 就是文件里那批渐变 id', () => {
    expect([...TWIN_2D_SPRITE_GRADIENT_IDS].sort()).toEqual(
      gradientIdsInFile().sort(),
    )
  })

  // 挨个拿文件里的真名去撞：连「实例前缀为空 + 图元内 id 直接叫这个名字」都撞不上
  it.each(gradientIdsInFile())('前缀方案产不出 %s', (docId) => {
    const forged = ['', 'a', docId, `${docId}-`].flatMap((prefix) =>
      ['', docId, `${prefix}${docId}`].map((id) =>
        svgGradientDomId(prefix, id),
      ),
    )

    expect(forged.some((id) => id === docId)).toBe(false)
  })

  it('文件里那批 id 一个都不以实例前缀的引子开头，所以两个命名空间不相交', () => {
    const lead = svgGradientDomId('', '').slice(0, 4)

    expect(lead).toBe('t2g-')
    expect(gradientIdsInFile().some((id) => id.startsWith(lead))).toBe(false)
  })
})
