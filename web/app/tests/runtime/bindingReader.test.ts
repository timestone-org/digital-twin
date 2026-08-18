/**
 * @fileoverview 契约：一条绑定读成运行时的槽结果，而 `PointSample` 的三档
 * 真的能让 `@dt/runtime` 的 `computeModuleStatus` 给出 stale / error——
 * 这正是 DASHBOARD_DESIGN §4.3 依赖的那条信息通路。
 */
import { describe, expect, it } from 'vitest'
import type { BindingPayload, BindingSpec, PointSample } from '@dt/contracts'
import { computeModuleStatus, computeModuleValues } from '@dt/runtime'

import { createBindingReader } from '@/runtime/bindingReader'

function binding(over: Partial<BindingPayload> = {}): BindingPayload {
  return {
    id: 'b1',
    nodeId: 'n1',
    fieldKey: 'value',
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

const SPEC: BindingSpec = { key: 'value', label: '数值', dataType: 'number' }

/** 用一份快照表造读取器。 */
function readerOf(samples: Record<string, PointSample>) {
  return createBindingReader((key) => samples[key])
}

/** 走一遍求值 + 状态机，验证一条绑定最终会让模块显示成什么。 */
function statusOf(
  bindings: readonly BindingPayload[],
  samples: Record<string, PointSample>,
): string {
  const evaluated = computeModuleValues({
    specs: [SPEC],
    bindings,
    read: readerOf(samples),
  })
  return computeModuleStatus({
    unboundRequiredCount: 0,
    tally: evaluated.tally,
  })
}

describe('实时点位', () => {
  it('还没收到过快照时是等首帧', () => {
    const slot = readerOf({})(
      binding({ sourceKind: 'opcua', nodeKey: 's:1' }),
      {},
    )

    expect(slot).toEqual({ state: 'pending' })
  })

  it('ok 档给值与采样时刻', () => {
    const slot = readerOf({
      's:1': { state: 'ok', value: 7, timestampMs: 99, quality: 'good' },
    })(binding({ sourceKind: 'opcua', nodeKey: 's:1' }), {})

    expect(slot).toEqual({ state: 'ok', value: 7, timestampMs: 99 })
  })

  it('时刻很旧的读数照给值，时刻原样带出不换成墙钟', () => {
    const slot = readerOf({
      's:1': { state: 'ok', value: 7, timestampMs: 42, quality: 'good' },
    })(binding({ sourceKind: 'opcua', nodeKey: 's:1' }), {})

    expect(slot).toEqual({ state: 'ok', value: 7, timestampMs: 42 })
  })

  it('error 档给原因，不拿 null 冒充读数', () => {
    const slot = readerOf({
      's:1': { state: 'error', errorMessage: '点位快照暂时读不到' },
    })(binding({ sourceKind: 'opcua', nodeKey: 's:1' }), {})

    expect(slot).toEqual({
      state: 'error',
      message: '点位快照暂时读不到',
    })
  })

  it('还没挑点位时说清楚，而不是永远等首帧', () => {
    const slot = readerOf({})(binding({ sourceKind: 'opcua' }), {})

    expect(slot).toEqual({ state: 'error', message: '实时绑定还没挑点位' })
  })
})

describe('常量与派生', () => {
  it('常量的零与假都是合法取值', () => {
    expect(readerOf({})(binding({ staticValueJson: 0 }), {})).toEqual({
      state: 'ok',
      value: 0,
    })
    expect(readerOf({})(binding({ staticValueJson: false }), {})).toEqual({
      state: 'ok',
      value: false,
    })
  })

  it('常量没配过时说得出为什么', () => {
    const slot = readerOf({})(binding({ staticValueJson: null }), {})

    expect(slot).toMatchObject({ state: 'error' })
  })

  it('派生按同节点的其它槽算', () => {
    const slot = readerOf({})(
      binding({
        fieldKey: 'total',
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['a', 'b'] },
      }),
      { a: 2, b: 3 },
    )

    expect(slot).toEqual({ state: 'ok', value: 5 })
  })

  it('派生没配运算规格时说得出为什么', () => {
    const slot = readerOf({})(
      binding({ sourceKind: 'computed', computeJson: null }),
      {},
    )

    expect(slot).toEqual({
      state: 'error',
      message: '派生绑定没有配置运算规格',
    })
  })
})

describe('历史序列', () => {
  it('同步读取器给不出历史，说清楚而不是留白', () => {
    const slot = readerOf({})(
      binding({
        sourceKind: 'archive',
        detailJson: { nodeKey: 's:1', range: { lastWindow: '1h' } },
      }),
      {},
    )

    expect(slot).toEqual({
      state: 'error',
      message: '历史序列要异步取数，画布上不展开',
    })
  })
})

describe('通到模块状态', () => {
  const realtime = [binding({ sourceKind: 'opcua', nodeKey: 's:1' })]

  it('很久没变的快照照样让模块显示成 connected', () => {
    expect(
      statusOf(realtime, {
        's:1': { state: 'ok', value: 1, timestampMs: 1, quality: 'good' },
      }),
    ).toBe('connected')
  })

  it('取不到的快照让模块显示成 error', () => {
    expect(
      statusOf(realtime, {
        's:1': { state: 'error', errorMessage: '读不到' },
      }),
    ).toBe('error')
  })

  it('正常的快照让模块显示成 connected', () => {
    expect(
      statusOf(realtime, {
        's:1': { state: 'ok', value: 1, timestampMs: 1, quality: 'good' },
      }),
    ).toBe('connected')
  })

  it('一帧都还没来时是 loading', () => {
    expect(statusOf(realtime, {})).toBe('loading')
  })
})
