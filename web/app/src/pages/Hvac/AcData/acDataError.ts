/**
 * @fileoverview 取数失败的分诊。
 *
 * ⚠ 压成一句「加载失败」会让三件完全不同的事看起来一样：还没绑数据源（自己去
 * 配就好）、外库不可用（等运维，且**不许拿旧值兜底**）、区间不合法（改一下就行）。
 */
import { ERROR_CODES } from '@dt/contracts'

import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'

export const AC_DATA_FAULTS = [
  'unbound',
  'unavailable',
  'range',
  'other',
] as const
export type AcDataFault = (typeof AC_DATA_FAULTS)[number]

export interface AcDataProblem {
  kind: AcDataFault
  message: string
}

/**
 * 把一次失败翻成「哪一类 + 说给用户的一句话」。
 * @param caught 捕获到的异常
 */
export function describeAcDataError(caught: unknown): AcDataProblem {
  const code = caught instanceof BizError ? caught.code : null
  if (code === ERROR_CODES.bindingNotFound) {
    return {
      kind: 'unbound',
      message: '这台空调还没有绑定数据源，先在台账页的「数据与达标」里绑一个。',
    }
  }
  if (code === ERROR_CODES.sourceUnavailable) {
    return {
      kind: 'unavailable',
      message: '外部数据源暂时不可用，这段时间的数据取不到；恢复后重试即可。',
    }
  }
  if (code === ERROR_CODES.timeRangeInvalid) {
    return { kind: 'range', message: describeError(caught) }
  }
  return { kind: 'other', message: describeError(caught) }
}
