/**
 * @fileoverview 锁住取数失败的分诊：三类各有各的出路，其余归一到「其它」。
 * ⚠ 分诊塌成一句「加载失败」时，「没绑数据源」与「外库挂了」在界面上一模一样，
 * 而前者用户自己就能解决。
 */
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '@dt/contracts'

import { BizError, TransportError } from '@/api/client'
import { describeAcDataError } from '@/pages/Hvac/AcData/acDataError'

function biz(code: number, message = '后端说的'): BizError {
  return new BizError(code, message, 400, 'trace')
}

describe('describeAcDataError', () => {
  it('还没绑定时指向「数据与达标」，那是用户自己能走通的一步', () => {
    const found = describeAcDataError(biz(ERROR_CODES.bindingNotFound))
    expect(found.kind).toBe('unbound')
    expect(found.message).toContain('数据与达标')
  })

  it('外库不可用时明说取不到，不暗示可以看旧数据', () => {
    const found = describeAcDataError(biz(ERROR_CODES.sourceUnavailable))
    expect(found.kind).toBe('unavailable')
    expect(found.message).toContain('不可用')
  })

  it('区间不合法时原样透后端的话——跨度上限是后端定的', () => {
    const found = describeAcDataError(
      biz(ERROR_CODES.timeRangeInvalid, '查询跨度超过 31 天'),
    )
    expect(found).toEqual({ kind: 'range', message: '查询跨度超过 31 天' })
  })

  it('别的业务码归到「其它」，仍然把后端的话说给用户', () => {
    const found = describeAcDataError(
      biz(ERROR_CODES.acUnitNotFound, '空调不存在'),
    )
    expect(found).toEqual({ kind: 'other', message: '空调不存在' })
  })

  it('传输层失败也走「其它」，用它自己的文案', () => {
    const found = describeAcDataError(
      new TransportError(0, '请求超时，请稍后重试'),
    )
    expect(found).toEqual({ kind: 'other', message: '请求超时，请稍后重试' })
  })

  it('压根不是异常对象时给一句兜底，不把 undefined 显示出去', () => {
    expect(describeAcDataError('boom')).toEqual({
      kind: 'other',
      message: '请求失败，请重试',
    })
  })
})
