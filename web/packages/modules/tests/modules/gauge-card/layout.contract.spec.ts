/**
 * @fileoverview 契约：五档几何的图形件都要在样式表里拿到一个**确定的宽度**。
 *
 * ⚠ 这条守的是一次真实的整块消失：弧那一档只写了 `aspect-ratio: 1/1`，而
 * `.gc-cell` 是 `align-items: center`（图形层按内容收缩）——`aspect-ratio` 只在
 * 另一维已确定时才推得出这一维，两维都不确定就一路塌成 **0 宽**，整只表一个像素
 * 都不画。typecheck、lint、1800 条单测全绿，happy-dom 不做布局所以渲染用例也看不见。
 * 唯一的防线是这里。
 * ⚠ 因此这份样式表里**不许**再出现 `aspect-ratio`：方形交给 svg 自己的
 * `preserveAspectRatio` 去等比缩，样式这一侧只管把盒子给足。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { GAUGE_SHAPE_VALUES } from '../../../src/modules/gauge-card/options'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const SHEET = readFileSync(
  join(process.cwd(), 'packages/modules/src/modules/gauge-card/_variants.scss'),
  'utf8',
)

/**
 * 每一档几何的图形链：链上**至少有一处**要写死宽度。
 * ⚠ 不是「最外那个元素必须有宽」——温度计的宽来自里面那根试管，储罐来自罐体本身。
 *   要的是链上有一处定得下来，剩下的按内容收缩即可。
 */
const CHAIN_OF: Readonly<Record<string, readonly string[]>> = {
  arc: ['.gc-shape--arc .gc-figure', '.gc-arc'],
  linear: [
    '.gc-shape--linear .gc-figure,\n.gc-shape--track .gc-figure',
    '.gc-bar',
  ],
  track: ['.gc-bar'],
  tank: ['.gc-tank'],
  thermometer: ['.gc-thermo__tube', '.gc-thermo__bulb'],
}

/**
 * 这个选择器那一块里声明的属性名。
 * @param selector 顶格写的选择器，形如 `.gc-arc`
 */
function declarationsOf(selector: string): string[] {
  const at = SHEET.indexOf(`\n${selector} {`)
  if (at < 0) return []
  const body = SHEET.slice(at, SHEET.indexOf('\n}', at))
  return [...body.matchAll(/^\s{2}([a-z-]+):/gm)].map(([, name]) => name ?? '')
}

describe('五档几何的宽度', () => {
  it('扫描本身没有空转——五档都登记了自己的图形链', () => {
    expect(GAUGE_SHAPE_VALUES.length).toBe(5)
    expect(
      GAUGE_SHAPE_VALUES.filter((shape) => CHAIN_OF[shape] === undefined),
    ).toEqual([])
  })

  // ⚠ 链上一处宽度都没有的那一档会塌成 0 宽，整块一个像素都不画，而两侧都不报错
  it('每一档的图形链上都至少有一处写死宽度', () => {
    const thin = GAUGE_SHAPE_VALUES.filter(
      (shape) =>
        !(CHAIN_OF[shape] ?? []).some((selector) =>
          declarationsOf(selector).includes('width'),
        ),
    )

    expect(thin).toEqual([])
  })

  it('扫描器真的读得出声明，不是恒空', () => {
    expect(declarationsOf('.gc-arc')).toContain('width')
    expect(declarationsOf('.gc-不存在')).toEqual([])
  })

  // ⚠ 方形交给 svg 的 preserveAspectRatio；样式这一侧一旦靠它推尺寸就会塌
  it('样式表里一处 aspect-ratio 都不许有', () => {
    const lines = SHEET.split('\n')
      .map((line, at) => ({ at: at + 1, line }))
      .filter(({ line }) => /^\s*aspect-ratio\s*:/.test(line))
      .map(({ at, line }) => `${String(at)}: ${line.trim()}`)

    expect(lines).toEqual([])
  })
})
