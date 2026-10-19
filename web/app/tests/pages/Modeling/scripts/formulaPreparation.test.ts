/** @fileoverview 训练准备与异常检测公式按冻结配置解释列序、时区及判定阈值。 */
import { describe, expect, it } from 'vitest'

import { formulaText } from '@/pages/Modeling/Canvas/scripts/formula'
import {
  formulasOf,
  type FormulaContext,
} from '@/pages/Modeling/Canvas/scripts/formulaCatalog'

function context(config: Record<string, unknown>): FormulaContext {
  return { blocks: [], ports: [], config }
}

describe('训练准备公式', () => {
  it('选列说明保留配置顺序', () => {
    const [spec] = formulasOf(
      'select_columns',
      context({ columns: ['负荷', '温度'] }),
    )

    expect(formulaText(spec?.filled ?? [])).toBe('C = 负荷、温度')
    expect(spec?.fallback).toBeNull()
  })

  it('时间平移以分钟展示并说明历史输入责任', () => {
    const [spec] = formulasOf('time_shift', context({ offset_minutes: 1440 }))

    expect(formulaText(spec?.filled ?? [])).toContain('1440')
    expect(spec?.notes.join('')).toContain('调用方须提供对应的历史值')
  })

  it('周期说明展示固定时区与周一起算的偏移', () => {
    const [spec] = formulasOf(
      'cyclic_time',
      context({
        timezone_offset_minutes: -300,
        cycles: ['day', 'week'],
      }),
    )

    expect(formulaText(spec?.filled ?? [])).toContain('-300')
    expect(spec?.legend.find((item) => item.symbol === 'δ')?.text).toContain(
      '4320',
    )
    expect(spec?.notes[0]).toContain('day、week')
  })

  it('无监督切分不默认展开且明确无需目标列', () => {
    const [spec] = formulasOf('split_samples', context({ test_ratio: 0.2 }))

    expect(spec?.isOpen).toBe(false)
    expect(spec?.notes.join('')).toContain('不需要目标列')
  })
})

describe('异常分数公式', () => {
  it('使用严格大于一的阈值并展示校准分位数', () => {
    const [spec] = formulasOf('anomaly_distance', context({ quantile: 0.99 }))

    expect(formulaText(spec?.symbolic ?? [])).toContain('score > 1')
    expect(formulaText(spec?.filled ?? [])).toContain('q = 0.99')
    expect(formulaText(spec?.filled ?? [])).toContain('max(1, Q_higher')
    expect(spec?.notes.join('')).toContain('不是故障概率')
    expect(spec?.fallback).toBeNull()
  })
})
