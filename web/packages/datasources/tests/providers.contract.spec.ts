/**
 * @fileoverview 契约：闭合集合与「按名字查表」的两张表必须与实现一一对齐。
 * ⚠ 漏登记一种来源或一个运算符，typecheck 与 lint 双双放行，表现只是那种绑定
 * 永远没数据——只有这份用例拦得住。
 */
import type { BindingSourceKind, DataSourceProvider } from '@dt/contracts'
import { BINDING_SOURCE_KINDS, COMPUTE_OPS } from '@dt/contracts'
import { beforeEach, describe, expect, it } from 'vitest'

import { computeValue, createComputedProvider } from '../src/computed/provider'
import type { DataSourceErrorCode } from '../src/errors'
import { DATA_SOURCE_ERROR_CODES } from '../src/errors'
import { createDatasetProvider } from '../src/dataset/provider'
import { createHistoryProvider } from '../src/history/provider'
import { createRealtimeProvider } from '../src/realtime/provider'
import {
  __resetProviders,
  getProvider,
  listProviders,
  registerProvider,
} from '../src/registry'
import { createStaticProvider } from '../src/static/provider'

const ERROR_CODE_MEMBERS: Record<DataSourceErrorCode, true> = {
  'unknown-source-kind': true,
  'unsupported-subscribe': true,
  'unsupported-history': true,
  'invalid-query': true,
  'missing-static-value': true,
  'fetch-failed': true,
}

function builtinProviders(): DataSourceProvider[] {
  return [
    createRealtimeProvider({ subscribe: () => () => undefined }),
    createStaticProvider(),
    createComputedProvider(),
    createHistoryProvider({
      fetchHistory: () =>
        Promise.resolve({ points: [], isTruncated: false, isStale: false }),
    }),
    createDatasetProvider({
      fetchSeries: () =>
        Promise.resolve({ points: [], isTruncated: false, isStale: false }),
    }),
  ]
}

beforeEach(() => {
  __resetProviders()
})

describe('内置 provider 与来源种类', () => {
  it('五种来源各有且只有一个内置实现', () => {
    const kinds = builtinProviders().map((provider) => provider.kind)

    expect([...kinds].sort()).toEqual([...BINDING_SOURCE_KINDS].sort())
  })

  it('全部登记后每种来源都取得到', () => {
    for (const provider of builtinProviders()) registerProvider(provider)

    const found = BINDING_SOURCE_KINDS.map(
      (kind: BindingSourceKind) => getProvider(kind).kind,
    )
    expect([...found]).toEqual([...BINDING_SOURCE_KINDS])
    expect(listProviders()).toHaveLength(BINDING_SOURCE_KINDS.length)
  })

  it('每个 provider 都实现了订阅与读历史两件事', () => {
    for (const provider of builtinProviders()) {
      expect(typeof provider.subscribe).toBe('function')
      expect(typeof provider.readHistory).toBe('function')
    }
  })
})

describe('运算符实现表', () => {
  it('每个运算符都算得出值', () => {
    const values = { a: 6, b: 3 }

    for (const op of COMPUTE_OPS) {
      expect(computeValue({ op, inputs: ['a', 'b'] }, values)).not.toBeNull()
    }
  })
})

describe('取数错误码', () => {
  it('类型成员与运行时常量对齐', () => {
    expect(Object.keys(ERROR_CODE_MEMBERS).sort()).toEqual(
      [...DATA_SOURCE_ERROR_CODES].sort(),
    )
  })
})
