/**
 * @fileoverview 守模块状态的优先级阶梯与它的**来源无感知**：输入只有各档槽的计数
 * 与通道连接态，没有任何来源种类——加一种来源不必碰这台状态机。另守必绑槽的缺口
 * 统计（数组槽 `rows[0].value` 就是把 `rows` 配上了）、以及 `stale` 那一档的口径：
 * 按连接态判、只在有值可显示时成立、硬问题优先，且它不盖整格。
 */
import type { BindingSpec } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  computeModuleStatus,
  countUnboundRequired,
  showsStatusOverlay,
} from '../src/moduleStatus'
import type { ModuleValuesTally } from '../src/moduleValues'
import { fakeBinding } from '../src/testing/fixtures'

const EMPTY_TALLY: ModuleValuesTally = {
  bound: 0,
  ok: 0,
  sampled: 0,
  empty: 0,
  pending: 0,
  error: 0,
}

function tally(patch: Partial<ModuleValuesTally>): ModuleValuesTally {
  return { ...EMPTY_TALLY, ...patch }
}

const REQUIRED_ROWS: BindingSpec = {
  key: 'rows',
  label: '行',
  dataType: 'number',
  isRequired: true,
  isArray: true,
  arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
}

const OPTIONAL_POWER: BindingSpec = {
  key: 'power',
  label: '功率',
  dataType: 'number',
}

describe('必绑槽的缺口', () => {
  it('必绑槽一条绑定都没有就是缺口', () => {
    expect(countUnboundRequired([REQUIRED_ROWS], [])).toBe(1)
  })

  it('数组行配上了就算这个槽配过了', () => {
    const bindings = [
      fakeBinding({ id: 'b1', fieldKey: 'rows[0].value', sourceKind: 'opcua' }),
    ]

    expect(countUnboundRequired([REQUIRED_ROWS], bindings)).toBe(0)
  })

  it('非必绑的槽没配也不算缺口', () => {
    expect(countUnboundRequired([OPTIONAL_POWER], [])).toBe(0)
  })

  it('同名前缀的别的槽不算配上', () => {
    const bindings = [
      fakeBinding({ id: 'b1', fieldKey: 'rowsTotal', sourceKind: 'opcua' }),
    ]

    expect(countUnboundRequired([REQUIRED_ROWS], bindings)).toBe(1)
  })
})

describe('状态阶梯', () => {
  it('没有绑定的模块是正常态', () => {
    expect(
      computeModuleStatus({ unboundRequiredCount: 0, tally: EMPTY_TALLY }),
    ).toBe('connected')
  })

  it('全部槽都取到了值是正常态', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 2, ok: 2 }),
      }),
    ).toBe('connected')
  })

  it('绑了但一个值都没有是空态', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, empty: 1 }),
      }),
    ).toBe('empty')
  })

  it('还有槽在等首帧是加载态', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 2, ok: 1, pending: 1 }),
      }),
    ).toBe('loading')
  })

  it('有槽取不到时压过等首帧：读不到比还没到更该说', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 2, ok: 1, error: 1, pending: 1 }),
      }),
    ).toBe('error')
  })

  it('值很久没变不影响状态：有值就是正常', () => {
    // 一天变一次的点位照样是 connected——时刻旧不构成一档状态
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 2, ok: 2 }),
      }),
    ).toBe('connected')
  })

  it('必绑槽没配压过取数失败：先把没配的配上，取数才谈得上', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 1,
        tally: tally({ bound: 1, error: 1 }),
      }),
    ).toBe('unbound')
  })

  it('渲染失败压过一切', () => {
    expect(
      computeModuleStatus({
        hasRenderError: true,
        unboundRequiredCount: 1,
        tally: tally({ bound: 1, ok: 1 }),
      }),
    ).toBe('error')
  })
})

describe('通道断了：数据可能过期', () => {
  it('通道断了而屏上还挂着推来的值，就是陈旧', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, ok: 1, sampled: 1 }),
        connectionState: 'reconnecting',
      }),
    ).toBe('stale')
  })

  it.each(['connecting', 'reconnecting', 'closed', 'error'] as const)(
    '只有 open 算通，%s 一律算断',
    (state) => {
      expect(
        computeModuleStatus({
          unboundRequiredCount: 0,
          tally: tally({ bound: 1, ok: 1, sampled: 1 }),
          connectionState: state,
        }),
      ).toBe('stale')
    },
  )

  it('通道连着就是正常态', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, ok: 1, sampled: 1 }),
        connectionState: 'open',
      }),
    ).toBe('connected')
  })

  it('⚠ 缺席不等于断开：设计态与独立渲染永不降档', () => {
    // 编辑器画布不装连接态，冒一枚角标只会让人去查一条不存在的故障
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, ok: 1, sampled: 1 }),
      }),
    ).toBe('connected')
  })

  it('⚠ 一个推来的值都没有时不叫陈旧：常量槽不会因为通道断了就过期', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, ok: 1 }),
        connectionState: 'closed',
      }),
    ).toBe('connected')
  })

  it('⚠ 一个值都没有时该说空态，不该说「可能过期」', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, empty: 1 }),
        connectionState: 'closed',
      }),
    ).toBe('empty')
  })

  it('还在等首帧时说加载中，不说过期', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 2, ok: 1, sampled: 1, pending: 1 }),
        connectionState: 'closed',
      }),
    ).toBe('loading')
  })

  it('硬问题压过陈旧：必绑槽没配来源', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 1,
        tally: tally({ bound: 2, ok: 1, sampled: 1 }),
        connectionState: 'closed',
      }),
    ).toBe('unbound')
  })

  it('硬问题压过陈旧：有槽取不到', () => {
    expect(
      computeModuleStatus({
        unboundRequiredCount: 0,
        tally: tally({ bound: 2, ok: 1, sampled: 1, error: 1 }),
        connectionState: 'closed',
      }),
    ).toBe('error')
  })

  it('硬问题压过陈旧：渲染失败', () => {
    expect(
      computeModuleStatus({
        hasRenderError: true,
        unboundRequiredCount: 0,
        tally: tally({ bound: 1, ok: 1, sampled: 1 }),
        connectionState: 'closed',
      }),
    ).toBe('error')
  })
})

describe('要不要盖整格', () => {
  it('自报交代状态的模块，陈旧那一档也照样放行——角标不盖格', () => {
    expect(showsStatusOverlay(true, 'stale')).toBe(true)
  })

  it('自报交代状态的模块，其余能自己画的档次不放行', () => {
    expect(showsStatusOverlay(true, 'error')).toBe(false)
    expect(showsStatusOverlay(true, 'loading')).toBe(false)
  })

  it('没自报的模块一律由浮层交代', () => {
    expect(showsStatusOverlay(false, 'stale')).toBe(true)
    expect(showsStatusOverlay(false, 'unbound')).toBe(true)
  })
})
