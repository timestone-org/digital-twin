/**
 * @fileoverview 守 info-list 的行数据组装：逐格四档各说各的话、副读数五档取的是哪一路、
 * 两条进度条的分母与几何、扩展指标「有值才出」、时刻三档语义不同，以及筛选、严重度排序与迟滞。
 * ⚠ 这些错了都不报错：墙上只是少一行、少一个百分号，或者时刻从「什么时候开始报的」
 * 悄悄变成「最后一帧什么时候到的」。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { readListLook } from '../../../src/modules/info-list/look'
import { meterPercent } from '../../../src/modules/info-list/rowAlarm'
import { reasonOf } from '../../../src/modules/info-list/rowValue'
import {
  buildListRows,
  countMissing,
  createHoldStore,
  isRowKept,
  listFieldKey,
  listRowCounts,
  listRowLabels,
  LIST_SLOT_KEY,
  readEmptyNote,
  readExtras,
  readListItems,
  readListPolicy,
  reconcileHold,
  selectRows,
  sinceMap,
  type ListRow,
} from '../../../src/modules/info-list/rows'

const AT = 1_700_000_000_000
const OK: ModuleSlotMeta = { state: 'ok', timestampMs: AT }

type Slots = Record<string, ModuleSlotMeta>

/** 一整块的行，`slots` 缺席即「运行时没下发逐槽结论」。 */
function build(
  config: Record<string, unknown>,
  values: unknown,
  slots?: Slots,
): ListRow[] {
  return buildListRows({
    config,
    rows: values,
    slots,
    look: readListLook(config),
  })
}

/** 只要第一行。 */
function first(
  config: Record<string, unknown>,
  values: unknown,
  slots?: Slots,
): ListRow {
  const [row] = build(config, values, slots)
  if (row === undefined) throw new Error('这一块一行都没有')
  return row
}

/** 把一行的每个子槽都标成有值。 */
function allOk(index: number, fields: readonly string[]): Slots {
  const slots: Slots = {}
  for (const field of fields) {
    slots[`${LIST_SLOT_KEY}[${index}].${field}`] = OK
  }
  return slots
}

describe('行配置的归一化', () => {
  it('脏行不丢、只补默认——丢一行会让它之后每条绑定改喂另一行', () => {
    const items = readListItems([{ label: '出水' }, 'dirty', null, {}])

    expect(items).toHaveLength(4)
    expect(items[0]?.label).toBe('出水')
    expect(items[3]?.precision).toBe(1)
  })

  it('单位不 trim——带空格是用户显式的排版意图', () => {
    const [item] = readListItems([{ unit: '° C' }])

    expect(item?.unit).toBe('° C')
  })

  it('小数位取整并夹到 0 到 6', () => {
    expect(readListItems([{ precision: 2.6 }])[0]?.precision).toBe(3)
    expect(readListItems([{ precision: -4 }])[0]?.precision).toBe(0)
    expect(readListItems([{ precision: 40 }])[0]?.precision).toBe(6)
  })

  it('量程与目标留空即不判，填字符串数字也认', () => {
    const [loose] = readListItems([{ range: { min: '0', max: '100' } }])
    const [empty] = readListItems([{}])

    expect(loose?.min).toBe(0)
    expect(loose?.max).toBe(100)
    expect(loose?.target).toBeNull()
    expect(empty?.min).toBeNull()
    expect(empty?.max).toBeNull()
  })

  it('扩展指标最多三格', () => {
    const specs = readExtras({
      extras: [
        { label: '功率', unit: 'kW' },
        { label: '温度', unit: '℃' },
        { label: '流量', unit: 'm³/h' },
        { label: '多余' },
      ],
    })

    expect(specs.map((spec) => spec.label)).toEqual(['功率', '温度', '流量'])
    expect(specs[0]?.precision).toBe(1)
  })
})

describe('逐格四档', () => {
  const config = { items: [{ label: '出水', unit: '℃' }] }

  it('没配来源那一档：占位符、不给单位、给一句去配绑定', () => {
    const row = first(config, [], {})

    expect(row.value.state).toBe('unbound')
    expect(row.value.text).toBe('—')
    expect(row.value.unit).toBe('')
    expect(row.value.reason).toContain('绑定')
  })

  it('等首帧与没配来源显示同一个占位符，只有档不同', () => {
    const pending = first(config, [], {
      [listFieldKey(0, 'value')]: { state: 'pending' },
    })
    const unbound = first(config, [], {})

    expect(pending.value.text).toBe(unbound.value.text)
    expect(pending.value.state).toBe('pending')
    expect(pending.value.reason).not.toBe(unbound.value.reason)
  })

  it('取不到那一档把取数侧给的原因带上，挂 title 才看得全', () => {
    const row = first(config, [], {
      [listFieldKey(0, 'value')]: { state: 'error', message: '通道断了' },
    })

    expect(row.value.state).toBe('error')
    expect(row.value.reason).toContain('通道断了')
  })

  it('有值那一档才给单位——「— ℃」看着像是有读数的', () => {
    const row = first(config, [{ value: 55.25 }], allOk(0, ['value']))

    expect(row.value.state).toBe('ok')
    expect(row.value.unit).toBe('℃')
    expect(row.value.reason).toBe('')
  })

  it('运行时没下发逐槽结论时退回「有没有值」，设计态画布走这条', () => {
    const withValue = first(config, [{ value: 1 }])
    const without = first(config, [])

    expect(withValue.value.state).toBe('ok')
    expect(without.value.state).toBe('unbound')
  })
})

describe('读数的展示文本', () => {
  it('千分位开着走分组，关掉连写', () => {
    const items = [{ label: 'a', precision: 1 }]
    const grouped = first({ items }, [{ value: 12345.67 }])
    const plain = first({ items, thousands: false }, [{ value: 12345.67 }])

    expect(grouped.value.text).toBe('12,345.7')
    expect(plain.value.text).toBe('12345.7')
  })

  it('真实 0 是读数不是空', () => {
    expect(first({ items: [{}] }, [{ value: 0 }]).value.text).toBe('0')
  })

  it('布尔与文本照实显示，不静默换成占位符', () => {
    expect(first({ items: [{}] }, [{ value: true }]).value.text).toBe('true')
    expect(first({ items: [{}] }, [{ value: '手动' }]).value.text).toBe('手动')
    expect(first({ items: [{}] }, [{ value: '  ' }]).value.text).toBe('—')
  })
})

describe('行名、分类与描述', () => {
  it('绑定的行名优先，缺值回落配置，都没有才叫「点位 N」', () => {
    const items = [{ label: '出水' }, {}]
    const bound = build({ items }, [{ name: '一号机' }, {}])

    expect(bound[0]?.label).toBe('一号机')
    expect(bound[1]?.label).toBe('点位 2')
    expect(build({ items }, [])[0]?.label).toBe('出水')
  })

  it('描述同一条口径：绑定文本优先、缺值回落行内描述', () => {
    const items = [{ desc: '静态描述' }]

    expect(first({ items }, [{ text: '推送描述' }]).desc).toBe('推送描述')
    expect(first({ items }, [{ text: '  ' }]).desc).toBe('静态描述')
  })

  it('分类与分组原样带出来，供 tag 件与分组用', () => {
    const row = first({ items: [{ tag: '余热', group: '洗浴' }] }, [])

    expect(row.tag).toBe('余热')
    expect(row.group).toBe('洗浴')
  })
})

describe('副读数五档取的是哪一路', () => {
  const items = [{ unit: 'kWh', range: { target: 120 } }]
  const values = [{ value: 10, aux: 3.5, aux2: 66, aux3: 7, text: '待执行' }]

  it('三个副读数槽各自独立——一行最多要一个副读数加两条各自取值的条', () => {
    const slots = allOk(0, ['aux', 'aux2', 'aux3'])

    expect(first({ items, subSource: 'aux' }, values, slots).sub.text).toBe(
      '3.5',
    )
    expect(first({ items, subSource: 'aux2' }, values, slots).sub.text).toBe(
      '66',
    )
    expect(first({ items, subSource: 'aux3' }, values, slots).sub.text).toBe(
      '7',
    )
  })

  it('副读数槽不套主读数的单位——那是另一种量', () => {
    const row = first({ items, subSource: 'aux' }, values, allOk(0, ['aux']))

    expect(row.sub.unit).toBe('')
  })

  it('目标那一档取行内配置，跟着主读数的单位走', () => {
    const row = first({ items, subSource: 'target' }, values, {})

    expect(row.sub.state).toBe('ok')
    expect(row.sub.text).toBe('120')
    expect(row.sub.unit).toBe('kWh')
  })

  it('目标留空 = 没配来源，不画', () => {
    const row = first({ items: [{}], subSource: 'target' }, values, {})

    expect(row.sub.state).toBe('unbound')
    expect(row.sub.text).toBe('—')
  })

  it('文本那一档取绑定文本槽，缺值回落行内描述', () => {
    const config = { items: [{ desc: '静态' }], subSource: 'text' }

    expect(first(config, values, {}).sub.text).toBe('待执行')
    expect(first(config, [{}], {}).sub.text).toBe('静态')
    expect(first({ ...config, items: [{}] }, [{}], {}).sub.state).toBe(
      'unbound',
    )
  })

  it('副读数前面的小字整块共用一份', () => {
    expect(first({ items, subLabel: ' 能效 ' }, values).subLabel).toBe('能效')
  })
})

describe('规则判的是哪一个读数', () => {
  const rules = [{ op: 'gte', value: 50, level: 'danger', label: '超标' }]

  it('缺省判主读数', () => {
    const row = first(
      { items: [{}], rules },
      [{ value: 80, aux: 1 }],
      allOk(0, ['value', 'aux']),
    )

    expect(row.level).toBe('danger')
    expect(row.alarmText).toBe('超标')
  })

  it('切到副读数之后，主读数超了也不算', () => {
    const row = first(
      { items: [{}], rules, alarmOn: 'sub', subSource: 'aux' },
      [{ value: 80, aux: 1 }],
      allOk(0, ['value', 'aux']),
    )

    expect(row.level).toBeNull()
  })

  it('判据那一格没有读数时一律不判——凭空一个颜色等于宣布一切正常', () => {
    const row = first({ items: [{}], rules }, [], {})

    expect(row.level).toBeNull()
    expect(row.badge.kind).toBe('none')
  })

  it('文本那一档没有数可判', () => {
    const row = first(
      { items: [{}], rules, alarmOn: 'sub', subSource: 'text' },
      [{ text: '99' }],
      {},
    )

    expect(row.level).toBeNull()
  })

  it('目标那一档判的是行内目标值', () => {
    const row = first(
      {
        items: [{ range: { target: 90 } }],
        rules,
        alarmOn: 'sub',
        subSource: 'target',
      },
      [],
      {},
    )

    expect(row.level).toBe('danger')
  })

  it('命中的闪烁与严重度权重都带出来，没命中排在最后', () => {
    const blinking = first(
      { items: [{}], rules: [{ op: 'gt', value: 0, blink: true }] },
      [{ value: 1 }],
    )
    const quiet = first({ items: [{}] }, [{ value: 1 }])

    expect(blinking.blink).toBe(true)
    expect(blinking.rank).toBeGreaterThan(quiet.rank)
    expect(quiet.rank).toBe(-1)
  })
})

describe('徽章四档', () => {
  const rules = [
    { op: 'gte', value: 50, level: 'danger', label: '超标', color: '' },
  ]
  const hot = [{ value: 80, status: 3 }]

  it('设备状态那一档只把状态交出去，文案由 StatusBadge 自己给', () => {
    const row = first({ items: [{}], badge: { kind: 'device' } }, hot)

    expect(row.badge.status).toBe('alarm')
    expect(row.badge.text).toBe('')
  })

  it('严重度那一档画的是严重度词与语义色，不跟规则自己的颜色走', () => {
    const row = first(
      {
        items: [{}],
        badge: { kind: 'severity' },
        rules: [{ ...rules[0], color: 'var(--accent-primary)' }],
      },
      hot,
    )

    expect(row.badge.text).toBe('危急')
    expect(row.badge.color).toBe('var(--state-danger)')
  })

  it('规则那一档画的是命中文案与规则自己的颜色', () => {
    const row = first(
      {
        items: [{}],
        badge: { kind: 'rule' },
        rules: [{ ...rules[0], color: 'var(--accent-primary)' }],
      },
      hot,
    )

    expect(row.badge.text).toBe('超标')
    expect(row.badge.color).toBe('var(--accent-primary)')
    expect(row.badge.vars['--il-badge-color']).toBe('var(--accent-primary)')
  })

  it('规则没写文案就没有词可画，一个空框比不画更糟', () => {
    const row = first(
      { items: [{}], badge: { kind: 'rule' }, rules: [{ op: 'gt', value: 0 }] },
      hot,
    )

    expect(row.badge.kind).toBe('none')
  })

  it('不画那一档连变量都不注入', () => {
    expect(first({ items: [{}] }, hot).badge.vars).toEqual({})
  })
})

describe('行的告警态', () => {
  it('接了设备状态槽的看状态', () => {
    const config = { items: [{}], badge: { kind: 'device' } }

    expect(first(config, [{ status: 3 }]).isAlarm).toBe(true)
    expect(first(config, [{ status: 1 }]).isAlarm).toBe(false)
  })

  it('其余档看命中的严重度，正常那一档不算告警', () => {
    const items = [{}]

    expect(
      first({ items, rules: [{ op: 'gt', value: 0, level: 'warning' }] }, [
        { value: 1 },
      ]).isAlarm,
    ).toBe(true)
    expect(
      first({ items, rules: [{ op: 'gt', value: 0, level: 'normal' }] }, [
        { value: 1 },
      ]).isAlarm,
    ).toBe(false)
  })
})

describe('逐行注入的两个色', () => {
  it('行内静态色压过命中色去染这一行', () => {
    const row = first(
      {
        items: [{ color: 'var(--accent-secondary)' }],
        rules: [{ op: 'gt', value: 0, color: 'var(--state-danger)' }],
      },
      [{ value: 1 }],
    )

    expect(row.vars['--il-row-color']).toBe('var(--accent-secondary)')
    expect(row.vars['--il-hit-color']).toBe('var(--state-danger)')
  })

  it('没有静态色时行色跟着命中色走', () => {
    const row = first(
      {
        items: [{}],
        rules: [{ op: 'gt', value: 0, color: 'var(--state-info)' }],
      },
      [{ value: 1 }],
    )

    expect(row.vars['--il-row-color']).toBe('var(--state-info)')
  })

  it('两样都没有就一个键都不写，由样式表的兜底接手', () => {
    expect(first({ items: [{}] }, [{ value: 1 }]).vars).toEqual({})
  })
})

describe('两条进度条', () => {
  const meter = { kind: 'bar', source: 'range', label: '占比' }
  const items = [{ range: { min: 0, max: 200 } }]

  it('量程档按行内量程算，读数不夹、条宽夹到 100', () => {
    const row = first({ items, meter }, [{ value: 300 }])

    expect(row.meter.text).toBe('150%')
    expect(row.meter.fill).toBe('100.0%')
  })

  it('量程缺上下界或上界不大于下界时算不出，也不画条', () => {
    const broken = first({ items: [{ range: { min: 5, max: 5 } }], meter }, [
      { value: 1 },
    ])

    expect(broken.meter.text).toBe('—')
    expect(broken.meter.fill).toBe('')
  })

  it('全表占比的分母是全部行的正数合计', () => {
    const rows = build(
      { items: [{}, {}, {}], meter: { ...meter, source: 'share' } },
      [{ value: 30 }, { value: 10 }, { value: -5 }],
    )

    expect(rows[0]?.meter.text).toBe('75%')
    expect(rows[1]?.meter.text).toBe('25%')
    expect(rows[2]?.meter.text).toBe('0%')
  })

  it('一行都没有主读数时占比算不出，不伪造 0%', () => {
    const rows = build({ items: [{}], meter: { ...meter, source: 'share' } }, [
      {},
    ])

    expect(rows[0]?.meter.text).toBe('—')
  })

  it('真实 0% 时整条填充不渲染——带辉光的一小截看着像「有一点点」', () => {
    const row = first({ items, meter }, [{ value: 0 }])

    expect(row.meter.text).toBe('0%')
    expect(row.meter.fill).toBe('')
  })

  it('副读数槽那三档把值直接当百分比', () => {
    const pick = (source: string, values: Record<string, unknown>) =>
      first({ items: [{}], meter: { ...meter, source } }, [values]).meter.text

    expect(pick('aux', { aux: 12 })).toBe('12%')
    expect(pick('aux2', { aux2: 42.5 })).toBe('42.5%')
    expect(pick('aux3', { aux3: 7 })).toBe('7%')
    expect(pick('aux', {})).toBe('—')
  })

  it('第二条独立选源、独立小字，缺省不画', () => {
    const both = first(
      {
        items,
        meter: { ...meter, source2: 'aux', label2: '液位' },
      },
      [{ value: 100, aux: 30 }],
    )
    const single = first({ items, meter }, [{ value: 100 }])

    expect(both.meter.label).toBe('占比')
    expect(both.meter2.label).toBe('液位')
    expect(both.meter2.text).toBe('30%')
    expect(single.meter2.show).toBe(false)
  })

  it('整簇不画那一档两条都不出', () => {
    const row = first({ items, meter: { kind: 'none', source2: 'aux' } }, [
      { value: 100, aux: 1 },
    ])

    expect(row.meter.show).toBe(false)
    expect(row.meter2.show).toBe(false)
  })

  it('关掉百分比读数只剩条', () => {
    const row = first({ items, meter: { ...meter, showPercent: false } }, [
      { value: 100 },
    ])

    expect(row.meter.text).toBe('')
    expect(row.meter.fill).toBe('50.0%')
  })
})

describe('扩展指标行', () => {
  const config = {
    items: [{}],
    rowShape: { extras: true },
    extras: [
      { label: '功率', unit: 'kW' },
      { label: '温度', unit: '℃' },
      { label: '流量', unit: 'm³/h' },
    ],
  }

  it('有值才出格，真实 0 算有值', () => {
    const row = first(config, [{ extra1: 12.34, extra2: 0 }])

    expect(row.extras.map((extra) => extra.label)).toEqual(['功率', '温度'])
    expect(row.extras[0]?.text).toBe('12.3')
    expect(row.extras[1]?.text).toBe('0')
    expect(row.extras[0]?.unit).toBe('kW')
  })

  it('一格都没绑时整行不画', () => {
    expect(first(config, [{}]).extras).toEqual([])
  })

  it('没声明扩展指标时哪个槽有值都不画', () => {
    expect(first({ items: [{}] }, [{ extra1: 1 }]).extras).toEqual([])
  })

  it('只声明一格时后两个槽有值也不画——格数由整块声明决定', () => {
    const one = {
      items: [{}],
      rowShape: { extras: true },
      extras: [{ label: '功率', unit: 'kW', precision: 0 }],
    }
    const row = first(one, [{ extra1: 5, extra2: 6, extra3: 7 }])

    expect(row.extras).toHaveLength(1)
    expect(row.extras[0]?.text).toBe('5')
  })
})

describe('时刻三档', () => {
  const items = [{}]

  it('采样档取的是这一槽的采样时刻，没有时刻就不画', () => {
    const sampled = first({ items }, [{ value: 1 }], allOk(0, ['value']))
    const nostamp = first({ items }, [{ value: 1 }], {
      [listFieldKey(0, 'value')]: { state: 'ok' },
    })

    expect(sampled.time).not.toBe('')
    expect(nostamp.time).toBe('')
  })

  it('绑定文本档原样显示推送来的字符串', () => {
    const row = first({ items, timeSource: 'bound' }, [{ time: '昨日 16:00' }])

    expect(row.time).toBe('昨日 16:00')
  })

  it('告警起始档留给迟滞去补，取值这一步先空着', () => {
    const row = first({ items, timeSource: 'alarmSince' }, [{ value: 1 }], {
      [listFieldKey(0, 'value')]: OK,
    })

    expect(row.time).toBe('')
  })

  it('选行时按迟滞里的起始时刻补上——那是「什么时候开始报的」，不是最后一帧', () => {
    const rows = build({ items, timeSource: 'alarmSince' }, [{ value: 1 }])
    const key = rows[0]?.key ?? ''
    const picked = selectRows(rows, {
      keys: [key],
      since: { [key]: AT },
      sort: 'docOrder',
      timeSource: 'alarmSince',
    })

    expect(picked[0]?.time).not.toBe('')
    expect(picked[0]?.time).toContain(':')
  })

  it('起始时刻还没记下来时不硬造一个', () => {
    const rows = build({ items, timeSource: 'alarmSince' }, [{ value: 1 }])
    const picked = selectRows(rows, {
      keys: rows.map((row) => row.key),
      since: {},
      sort: 'docOrder',
      timeSource: 'alarmSince',
    })

    expect(picked[0]?.time).toBe('')
  })
})

describe('行的键', () => {
  it('键由行身份派生，配置重排时同一逻辑行的键不变', () => {
    const one = build({ items: [{ label: 'A' }, { label: 'B' }] }, [])
    const flipped = build({ items: [{ label: 'B' }, { label: 'A' }] }, [])

    expect(one[1]?.key).toBe(flipped[0]?.key)
  })

  it('两行完全同配置时仍得到不同的键', () => {
    const rows = build({ items: [{ label: 'A' }, { label: 'A' }] }, [])

    expect(rows[0]?.key).not.toBe(rows[1]?.key)
  })

  it('一个字段都没填的行之间也不撞键', () => {
    const rows = build({ items: [{}, {}, {}] }, [])

    expect(new Set(rows.map((row) => row.key)).size).toBe(3)
  })
})

describe('筛选与排序', () => {
  const config = {
    items: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
    rules: [
      { op: 'gte', value: 90, level: 'danger' },
      { op: 'gte', value: 50, level: 'normal' },
    ],
  }
  const values = [{ value: 95 }, { value: 60 }, { value: 1 }]

  it('三档筛选各筛各的，「命中」与「只看告警」的差就是正常也算命中', () => {
    const rows = build(config, values)
    const kept = (filter: 'all' | 'hit' | 'alarm') =>
      rows.filter((row) => isRowKept(row, filter)).map((row) => row.label)

    expect(kept('all')).toEqual(['A', 'B', 'C'])
    expect(kept('hit')).toEqual(['A', 'B'])
    expect(kept('alarm')).toEqual(['A'])
  })

  it('严重度降序，同级按配置序稳定', () => {
    const rows = build(
      {
        items: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
        rules: [{ op: 'gt', value: 0, level: 'warning' }],
      },
      [{ value: 1 }, { value: 0 }, { value: 1 }],
    )
    const picked = selectRows(rows, {
      keys: rows.map((row) => row.key),
      since: {},
      sort: 'severity',
      timeSource: 'sample',
    })

    expect(picked.map((row) => row.label)).toEqual(['A', 'C', 'B'])
  })

  it('配置序那一档原样保留文档序', () => {
    const rows = build(config, values)
    const picked = selectRows(rows, {
      keys: rows.map((row) => row.key),
      since: {},
      sort: 'docOrder',
      timeSource: 'sample',
    })

    expect(picked.map((row) => row.label)).toEqual(['A', 'B', 'C'])
  })

  it('不在场的行键选不出来', () => {
    const rows = build(config, values)
    const picked = selectRows(rows, {
      keys: [rows[1]?.key ?? ''],
      since: {},
      sort: 'docOrder',
      timeSource: 'sample',
    })

    expect(picked.map((row) => row.label)).toEqual(['B'])
  })
})

describe('迟滞', () => {
  it('持续命中期间起始时刻不变', () => {
    const first0 = reconcileHold([], ['a'], 1000, 5000)
    const again = reconcileHold(first0.entries, ['a'], 4000, 5000)

    expect(again.entries[0]?.since).toBe(1000)
    expect(again.nextWakeMs).toBeNull()
  })

  it('清除后按迟滞时长多留一会儿，到点才真的走', () => {
    const start = reconcileHold([], ['a'], 0, 5000)
    const held = reconcileHold(start.entries, [], 1000, 5000)
    const dropped = reconcileHold(held.entries, [], 6000, 5000)

    expect(held.entries.map((entry) => entry.key)).toEqual(['a'])
    expect(held.entries[0]?.active).toBe(false)
    expect(held.nextWakeMs).toBe(4000)
    expect(dropped.entries).toEqual([])
    expect(dropped.nextWakeMs).toBeNull()
  })

  it('迟滞关掉时清除即走', () => {
    const start = reconcileHold([], ['a'], 0, 0)
    const next = reconcileHold(start.entries, [], 1, 0)

    expect(next.entries).toEqual([])
  })

  it('下一次该醒来的是最早到期的那一条', () => {
    const seeded = [
      { key: 'a', since: 0, active: false },
      { key: 'b', since: 500, active: false },
    ]
    const result = reconcileHold(seeded, [], 600, 1000)

    expect(result.nextWakeMs).toBe(400)
  })

  it('重新命中的行接着用原来的起始时刻，抖动不重置', () => {
    const start = reconcileHold([], ['a'], 0, 5000)
    const gone = reconcileHold(start.entries, [], 1000, 5000)
    const back = reconcileHold(gone.entries, ['a'], 2000, 5000)

    expect(back.entries[0]?.since).toBe(0)
    expect(back.entries[0]?.active).toBe(true)
  })

  it('句柄自己记着上一轮，dispose 之后从头开始', () => {
    const store = createHoldStore()
    store.reconcile(['a'], 1000, 5000)

    expect(store.reconcile(['a'], 4000, 5000).entries[0]?.since).toBe(1000)

    store.dispose()

    expect(store.reconcile(['a'], 9000, 5000).entries[0]?.since).toBe(9000)
  })

  it('迟滞表摊成「行键到起始时刻」', () => {
    expect(
      sinceMap([
        { key: 'a', since: 1, active: true },
        { key: 'b', since: 2, active: false },
      ]),
    ).toEqual({ a: 1, b: 2 })
  })
})

describe('筛选、排序与迟滞四个旋钮', () => {
  it('缺省是全部、配置序、采样时刻、不迟滞', () => {
    expect(readListPolicy({})).toEqual({
      filter: 'all',
      sort: 'docOrder',
      timeSource: 'sample',
      holdMs: 0,
    })
  })

  it('迟滞秒数夹到 0 到 300 再换成毫秒', () => {
    expect(readListPolicy({ holdSeconds: 30 }).holdMs).toBe(30_000)
    expect(readListPolicy({ holdSeconds: -5 }).holdMs).toBe(0)
    expect(readListPolicy({ holdSeconds: 9_999 }).holdMs).toBe(300_000)
  })

  it('认不出的档一律回落', () => {
    const policy = readListPolicy({
      rowFilter: 'nope',
      rowSort: 'random',
      timeSource: 'wall',
    })

    expect(policy).toEqual({
      filter: 'all',
      sort: 'docOrder',
      timeSource: 'sample',
      holdMs: 0,
    })
  })
})

describe('空态三档', () => {
  const config = { items: [{}], noRowsText: '暂无点位', calmText: '一切正常' }

  it('还有行要画时一句话都不说', () => {
    const rows = build(config, [{ value: 1 }])

    expect(readEmptyNote({ config, rows, shown: 1 })).toBe('')
  })

  it('一项都没配时说的是空态文案', () => {
    expect(readEmptyNote({ config, rows: [], shown: 0 })).toBe('暂无点位')
    expect(readEmptyNote({ config: {}, rows: [], shown: 0 })).toBe('暂无数据')
  })

  it('绑了却一个读数都没回来时报数，不伪装成「无告警」', () => {
    const rows = build(config, [], {})

    expect(readEmptyNote({ config, rows, shown: 0 })).toBe('1 个点位无数据')
    expect(countMissing(rows)).toBe(1)
  })

  it('全部有值又全部平静时才说平静', () => {
    const rows = build(config, [{ value: 1 }], allOk(0, ['value']))

    expect(readEmptyNote({ config, rows, shown: 0 })).toBe('一切正常')
    expect(countMissing(rows)).toBe(0)
  })
})

describe('绑点面板那两份派生', () => {
  it('每一行的键是这一行第一个子槽的 fieldKey', () => {
    const items = readListItems([{ label: '出水', emitValue: 'T1' }, {}])

    expect(listRowLabels(items)).toEqual({
      'listValues[0].value': { title: '出水', id: 'T1' },
      'listValues[1].value': { title: '点位 2', id: '' },
    })
  })

  it('数组槽应有几行跟着行列表走', () => {
    expect(listRowCounts(readListItems([{}, {}]))).toEqual({ listValues: 2 })
    expect(listRowCounts([])).toEqual({ listValues: 0 })
  })

  it('子槽的 fieldKey 按下标与子槽名拼', () => {
    expect(listFieldKey(2, 'aux2')).toBe('listValues[2].aux2')
  })
})

describe('取值原语的边角', () => {
  it('有值那一档问「为什么没有值」时一个字都不说', () => {
    expect(reasonOf('ok', undefined)).toBe('')
    expect(reasonOf('error', undefined)).toBe('取不到')
  })

  it('布尔的假值照实显示，不落成占位符', () => {
    expect(first({ items: [{}] }, [{ value: false }]).value.text).toBe('false')
  })

  it('全表占比的分母被喂成 0 时给 0% 而不是无穷大', () => {
    expect(
      meterPercent('share', {
        value: 5,
        aux: null,
        aux2: null,
        aux3: null,
        min: null,
        max: null,
        shareBasis: 0,
        anyValue: true,
      }),
    ).toBe(0)
  })

  it('认不出的选源一律算不出，不拿主读数顶替', () => {
    expect(
      meterPercent('none', {
        value: 5,
        aux: 1,
        aux2: null,
        aux3: null,
        min: 0,
        max: 10,
        shareBasis: 5,
        anyValue: true,
      }),
    ).toBeNull()
  })
})
