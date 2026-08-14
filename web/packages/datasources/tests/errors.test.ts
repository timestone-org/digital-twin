/**
 * @fileoverview 契约：取数错误带稳定的原因码与 cause 链——调用方按 `code`
 * 分支，不按 `message` 分支（文案会改、会翻译）。
 */
import { describe, expect, it } from 'vitest'

import {
  DATA_SOURCE_ERROR_CODES,
  DataSourceError,
  describeError,
  isDataSourceError,
} from '../src/errors'

describe('取数错误', () => {
  it('带原因码与可辨认的名字', () => {
    const error = new DataSourceError('invalid-query', '时间窗左右颠倒')

    expect(error.code).toBe('invalid-query')
    expect(error.name).toBe('DataSourceError')
    expect(error.message).toBe('时间窗左右颠倒')
  })

  it('包装外层错误时保住原始错误', () => {
    const cause = new Error('502 Bad Gateway')
    const error = new DataSourceError('fetch-failed', '历史取数失败', {
      cause,
    })

    expect(error.cause).toBe(cause)
  })

  it('原因码是这六种', () => {
    expect([...DATA_SOURCE_ERROR_CODES]).toEqual([
      'unknown-source-kind',
      'unsupported-subscribe',
      'unsupported-history',
      'invalid-query',
      'missing-static-value',
      'fetch-failed',
    ])
  })

  it('只认自家错误，普通 Error 不算', () => {
    expect(isDataSourceError(new DataSourceError('invalid-query', '坏'))).toBe(
      true,
    )
    expect(isDataSourceError(new Error('坏'))).toBe(false)
    expect(isDataSourceError('坏')).toBe(false)
    expect(isDataSourceError(null)).toBe(false)
  })
})

describe('把 catch 到的值说成一句话', () => {
  it('Error 取它的 message', () => {
    expect(describeError(new Error('连接被拒'))).toBe('连接被拒')
  })

  it('非 Error 值原样转成字符串', () => {
    expect(describeError('超时')).toBe('超时')
    expect(describeError(404)).toBe('404')
    expect(describeError(undefined)).toBe('undefined')
  })
})
