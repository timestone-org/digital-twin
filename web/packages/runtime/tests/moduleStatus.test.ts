/**
 * @fileoverview 守模块状态的优先级阶梯与它的**来源无感知**：输入只有各档槽的计数，
 * 没有任何来源种类——加一种来源不必碰这台状态机。另守必绑槽的缺口统计
 * （数组槽 `rows[0].value` 就是把 `rows` 配上了）。
 */
import type { BindingSpec } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { computeModuleStatus, countUnboundRequired } from '../src/moduleStatus'
import type { ModuleValuesTally } from '../src/moduleValues'
import { fakeBinding } from '../src/testing/fixtures'

const EMPTY_TALLY: ModuleValuesTally = {
  bound: 0,
  ok: 0,
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
