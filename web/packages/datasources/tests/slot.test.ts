/**
 * @fileoverview 契约：取数结果只有 ok 与 error 两档，取不到就说取不到。
 * ⚠ 失败绝不退化成空序列——空序列会被读成「这段时间没数据」，那是另一个事实。
 */
import { describe, expect, it } from 'vitest'

import { DataSourceError } from '../src/errors'
import { errorSlot, okSlot } from '../src/slot'

describe('槽结果', () => {
  it('ok 槽带值，error 槽带原因', () => {
    const error = new DataSourceError('invalid-query', '缺点位')

    expect(okSlot(12)).toEqual({ state: 'ok', value: 12 })
    expect(errorSlot(error)).toEqual({ state: 'error', error })
  })
})
