/**
 * @fileoverview 守实时数值模块的取值口径：四档状态各说各的话、单位只跟着读数走、
 * 0 是读数不是空、四段带的优先级与开闭区间，以及绑点面板那两份派生。
 * ⚠ 这几条错了都不会报错：墙上只是显示一个「—」或一个没告警的红线值。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  boundaryRules,
  buildMetricCells,
  metricFieldKey,
  metricRowCounts,
  metricRowLabels,
  readMetricItems,
  type MetricCellsInput,
} from '../../../src/modules/metric-card/metrics'

const OK: ModuleSlotMeta = { state: 'ok', timestampMs: 1_700_000_000_000 }

function cells(
  items: readonly unknown[],
  rows: unknown,
  slots?: Record<string, ModuleSlotMeta>,
  extra: Partial<MetricCellsInput> = {},
) {
  return buildMetricCells({
    items: readMetricItems(items),
    rows,
    slots,
    emptyText: '—',
    grouping: false,
    ...extra,
  })
}

/** 一行读数的注入形状，与 `injectFieldValue` 展开出来的一致。 */
function row(value: unknown): { value: unknown } {
  return { value }
}

describe('指标列表的归一化', () => {
  it('缺项补默认，不丢行——丢一行会让其后每条绑定改喂另一个指标', () => {
    const items = readMetricItems([{ label: '温度' }, 'dirty', null, {}])

    expect(items).toHaveLength(4)
    expect(items[0]?.label).toBe('温度')
    expect(items[1]?.kind).toBe('number')
    expect(items[3]?.precision).toBe(1)
  })

  it('阈值边界留空即不判，填了字符串数字也认', () => {
    const [item] = readMetricItems([{ warnAbove: '80', dangerAbove: 95 }])

    expect(item?.warnAbove).toBe(80)
    expect(item?.dangerAbove).toBe(95)
    expect(item?.warnBelow).toBeNull()
    expect(item?.dangerBelow).toBeNull()
  })

  it('槽键按下标拼，与孪生同一套形状', () => {
    expect(metricFieldKey(0)).toBe('itemValues[0].value')
    expect(metricFieldKey(3)).toBe('itemValues[3].value')
  })
})

describe('一格的四档状态', () => {
  it('没配来源、等首帧、取不到三档各说各的话', () => {
    const items = [{ label: 'A' }, { label: 'B' }, { label: 'C' }]
    const slots = {
      [metricFieldKey(1)]: { state: 'pending' } as ModuleSlotMeta,
      [metricFieldKey(2)]: {
        state: 'error',
        message: '实时绑定还没挑点位',
      } as ModuleSlotMeta,
    }

    const [unbound, pending, failed] = cells(items, [], slots)

    expect(unbound?.state).toBe('unbound')
    expect(unbound?.stateLabel).toBe('未绑定')
    expect(pending?.stateLabel).toBe('等待首帧')
    expect(failed?.stateLabel).toBe('取不到')
    expect(failed?.reason).toContain('实时绑定还没挑点位')
  })

  it('取不到时不画单位——「— kV」看着像是有读数的', () => {
    const slots = { [metricFieldKey(0)]: { state: 'error' } as ModuleSlotMeta }

    const [cell] = cells([{ label: '电压', unit: 'kV' }], [], slots)

    expect(cell?.text).toBe('—')
    expect(cell?.unit).toBe('')
  })

  it('0 是读数不是空，照实显示', () => {
    const [cell] = cells(
      [{ label: '功率', unit: 'MW', precision: 2 }],
      [row(0)],
      {
        [metricFieldKey(0)]: OK,
      },
    )

    expect(cell?.state).toBe('ok')
    expect(cell?.text).toBe('0.00')
    expect(cell?.unit).toBe('MW')
  })

  it('运行时没下发逐槽结论时（设计态画布），有值就显示、没值算未绑定', () => {
    const [withValue, without] = cells(
      [{ label: 'A', precision: 0 }, { label: 'B' }],
      [row(42)],
    )

    expect(withValue?.text).toBe('42')
    expect(without?.state).toBe('unbound')
  })

  it('采样时刻逐格各带各的，不共用整块那一个', () => {
    const slots = {
      [metricFieldKey(0)]: OK,
      [metricFieldKey(1)]: { state: 'ok' } as ModuleSlotMeta,
    }

    const [timed, untimed] = cells(
      [{ label: 'A' }, { label: 'B' }],
      [row(1), row(2)],
      slots,
    )

    expect(timed?.updatedAt).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(untimed?.updatedAt).toBe('')
  })
})

describe('值的展示档', () => {
  it('数值档补齐小数位，千分位由开关决定', () => {
    const slots = { [metricFieldKey(0)]: OK }
    const item = [{ label: '电量', precision: 1 }]

    expect(cells(item, [row(12345.67)], slots)[0]?.text).toBe('12345.7')
    expect(
      cells(item, [row(12345.67)], slots, { grouping: true })[0]?.text,
    ).toBe('12,345.7')
  })

  it('开关量认数值 0/1——工控点位的开关量绝大多数不是 JSON 布尔', () => {
    const slots = { [metricFieldKey(0)]: OK, [metricFieldKey(1)]: OK }
    const items = [
      { label: '甲', kind: 'boolean' },
      { label: '乙', kind: 'boolean' },
    ]

    const [on, off] = cells(items, [row(1), row(0)], slots)

    expect(on?.text).toBe('运行')
    expect(off?.text).toBe('停止')
  })

  it('开关量的文案可改写', () => {
    const [cell] = cells(
      [{ label: '阀', kind: 'boolean', trueText: '已开', falseText: '已关' }],
      [row(true)],
      { [metricFieldKey(0)]: OK },
    )

    expect(cell?.text).toBe('已开')
  })

  it('开关量收到既不是布尔也不是数的值时照实显示，不猜成停止', () => {
    const [cell] = cells([{ label: '阀', kind: 'boolean' }], [row('检修')], {
      [metricFieldKey(0)]: OK,
    })

    expect(cell?.text).toBe('检修')
  })

  it('认不出的值照实显示，不静默换成占位符', () => {
    const [cell] = cells([{ label: '状态', kind: 'text' }], [row('检修中')], {
      [metricFieldKey(0)]: OK,
    })

    expect(cell?.text).toBe('检修中')
  })
})

describe('四段带阈值', () => {
  it('两条危险排在预警前面，同时越界时报危险', () => {
    const [item] = readMetricItems([{ warnAbove: 80, dangerAbove: 95 }])
    const rules = item === undefined ? [] : boundaryRules(item)

    expect(rules.map((rule) => rule.level)).toEqual(['danger', 'warning'])
  })

  it('上下界是开区间：正好等于上限不告警', () => {
    const slots = { [metricFieldKey(0)]: OK, [metricFieldKey(1)]: OK }
    const items = [
      { label: 'A', warnAbove: 80 },
      { label: 'B', warnAbove: 80 },
    ]

    const [atBound, over] = cells(items, [row(80), row(80.1)], slots)

    expect(atBound?.level).toBe('normal')
    expect(over?.level).toBe('warning')
  })

  it('没配边界就连「正常」都不说——没有判据', () => {
    const [cell] = cells([{ label: 'A' }], [row(63)], {
      [metricFieldKey(0)]: OK,
    })

    expect(cell?.level).toBeNull()
  })

  it('没有读数时一律不着色，不给一个凭空的绿灯', () => {
    const [cell] = cells([{ label: 'A', warnAbove: 80 }], [], {
      [metricFieldKey(0)]: { state: 'error' },
    })

    expect(cell?.level).toBeNull()
  })

  it('每一档都带文案：只有颜色的话，越了哪一侧的界看不出来', () => {
    const slots = { [metricFieldKey(0)]: OK, [metricFieldKey(1)]: OK }
    const items = [
      { label: 'A', warnAbove: 80, dangerAbove: 95 },
      { label: 'B', warnBelow: 10, dangerBelow: 5 },
    ]

    const [high, low] = cells(items, [row(99), row(8)], slots)

    expect(high?.hitLabel).toBe('过高')
    expect(low?.hitLabel).toBe('偏低')
  })

  it('开关量也能触发红灯：阈值判的是原始数值不是展示文本', () => {
    const [cell] = cells(
      [{ label: '主泵', kind: 'boolean', dangerBelow: 1 }],
      [row(0)],
      { [metricFieldKey(0)]: OK },
    )

    expect(cell?.text).toBe('停止')
    expect(cell?.level).toBe('danger')
  })
})

describe('绑点面板的两份派生', () => {
  it('行数跟着指标列表走，面板因此不摆手工增删键', () => {
    expect(metricRowCounts(readMetricItems([{}, {}, {}]))).toEqual({
      itemValues: 3,
    })
  })

  it('一个指标都没有时也要给 0，不许把槽键漏掉', () => {
    expect(metricRowCounts(readMetricItems([]))).toEqual({ itemValues: 0 })
  })

  it('行名给人看、行 id 给人核对，没填名字的行退回「指标 N」', () => {
    const labels = metricRowLabels(
      readMetricItems([{ label: '主变温度', key: 'T1' }, {}]),
    )

    expect(labels[metricFieldKey(0)]).toEqual({ title: '主变温度', id: 'T1' })
    expect(labels[metricFieldKey(1)]).toEqual({ title: '指标 2', id: '' })
  })
})
