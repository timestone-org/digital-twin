/** @fileoverview 采集点位的交互与数据完整性契约。 */
import { describe, expect, it } from 'vitest'
import { pointStatus } from '@/pages/Collect/Opcua/scripts/pointStatus'

describe('点位状态', () => {
  it('没有读数不伪装成异常或正常', () => {
    expect(pointStatus(undefined, true)).toBe('waiting')
  })
  it('旧消息优先标陈旧', () => {
    expect(pointStatus({ state: 'error', errorMessage: '失败' }, true)).toBe(
      'stale',
    )
  })
  it('拒绝与质量存疑都属于异常', () => {
    expect(pointStatus({ state: 'error', errorMessage: '失败' }, false)).toBe(
      'abnormal',
    )
    expect(
      pointStatus(
        { state: 'ok', quality: 'uncertain', value: 1, timestampMs: 1 },
        false,
      ),
    ).toBe('abnormal')
  })
  it('旧采样时间但新收到的正常值仍正常', () => {
    expect(
      pointStatus(
        { state: 'ok', quality: 'good', value: 0, timestampMs: 1 },
        false,
      ),
    ).toBe('good')
  })
})
