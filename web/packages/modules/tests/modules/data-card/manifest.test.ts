/**
 * @fileoverview 契约：绑点面板上这张卡片长什么样——十几格全靠数行号认对象，
 * 是这套面板最容易接错的地方。
 *
 * ⚠ 行数与行名都由 `cells` 配置驱动：不声明行数的话，面板会摆出「新增一行」，
 * 加出来的那一行永远喂不到任何东西（DASHBOARD_DESIGN §4.2）。
 */
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/data-card/manifest'

const SLOT = 'cellValues'

/**
 * 按一份格表问清单要行名。
 * @param cells 格表
 */
function labels(cells: unknown) {
  return manifest.bindingRowLabels?.({ cells }) ?? {}
}

describe('行名', () => {
  it('每一格一条，名字就是格名', () => {
    expect(labels([{ label: '进水温度' }, { label: '回水温度' }])).toEqual({
      [`${SLOT}[0].value`]: { title: '进水温度', id: '' },
      [`${SLOT}[1].value`]: { title: '回水温度', id: '' },
    })
  })

  // ⚠ 没配名称的格在墙上不画名字，但面板上仍得有个称呼——否则一列全是空白
  it('没配名称的格在面板上按行号称呼', () => {
    expect(labels([{}])[`${SLOT}[0].value`]?.title).toBe('第 1 格')
  })

  it('联动值跟着格走，面板据此认得出是同一格', () => {
    expect(
      labels([{ label: '甲', emitValue: 'a' }])[`${SLOT}[0].value`]?.id,
    ).toBe('a')
  })

  it('一格都没有时给空表，不报错', () => {
    expect(labels(undefined)).toEqual({})
  })
})

describe('行数', () => {
  it('行数就是格数——面板据此不摆「新增一行」', () => {
    expect(manifest.bindingRowCounts?.({ cells: [{}, {}, {}] })).toEqual({
      [SLOT]: 3,
    })
  })

  it('没配过格时是 0', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [SLOT]: 0 })
  })
})
