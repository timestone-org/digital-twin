/** @fileoverview 模型详情里后处理规则的人话。 */
import { describe, expect, it } from 'vitest'

import { postprocessText } from '@/pages/Modeling/Models/scripts/postprocessText'

describe('postprocessText', () => {
  it('限幅说清两端，没设的那一端写空', () => {
    expect(
      postprocessText({
        operator: 'clamp_prediction',
        label: '预测限幅',
        config: { lower: 0, upper: null },
      }),
    ).toBe('预测限幅：下限 0，上限 空')
  })

  it('条件替换把运算译成中文', () => {
    expect(
      postprocessText({
        operator: 'replace_prediction',
        label: '预测条件替换',
        config: { op: 'lt', threshold: 5, value: 0 },
      }),
    ).toBe('预测条件替换：小于 5 时取 0')
  })

  it('取整说清位数与方式', () => {
    expect(
      postprocessText({
        operator: 'round_prediction',
        label: '预测取整',
        config: { decimals: 2, mode: 'floor' },
      }),
    ).toBe('预测取整：保留 2 位小数，向下取整')
  })

  it('不认识的算子退回名字', () => {
    expect(
      postprocessText({ operator: 'later', label: '将来的', config: {} }),
    ).toBe('将来的')
  })
})
