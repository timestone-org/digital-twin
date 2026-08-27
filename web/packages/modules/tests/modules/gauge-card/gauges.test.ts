/**
 * @fileoverview 守 gauge-card 的取值链：四档状态逐档、量程 → 百分比 → 填充、读数四档、
 * 「万」格式与量程上界不到一万时的整体回落、刻度的等距落点与防裁切基准、目标标记的绑定
 * 优先，以及轨道内 pill 的完成率可以超过一百。
 * ⚠ 这几条错了都不报错：数字照样在屏上跳，只是含义变了——完成率退化成量程占比、
 * 「配了两列」变成自适应、真实 0% 留下一小截带辉光的色块。
 */
import type { ModuleSlotMeta } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  buildGaugeViews,
  gaugeFieldKey,
  gaugeState,
  GAUGE_ITEMS_KEY,
  GAUGE_SLOT_KEY,
  GAUGE_STATE_CLASS,
  readGaugeItems,
  reasonOf,
  type GaugeView,
} from '../../../src/modules/gauge-card/gauges'

/** 一行仪表配置，量程 0–100、单位 kW、整数读数。 */
function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { label: '主蒸汽压力', unit: 'kW', min: 0, max: 100, ...over }
}

/** 一整块的取值，`rows` 与 `slots` 都按第一个仪表喂。 */
function build(
  config: Record<string, unknown>,
  rows: unknown = [],
  slots?: Record<string, ModuleSlotMeta>,
): GaugeView[] {
  return buildGaugeViews({ config, rows, slots })
}

/** 只有一个仪表时取它。 */
function only(
  config: Record<string, unknown>,
  rows: unknown = [],
  slots?: Record<string, ModuleSlotMeta>,
): GaugeView {
  const views = build(config, rows, slots)
  const view = views[0]
  if (view === undefined) throw new Error('这一块一个仪表都没摊出来')
  return view
}

/** 一个仪表 + 一帧读数 + 一份逐槽结论的常用组合。 */
function one(
  over: Record<string, unknown> = {},
  value: unknown = 42,
  state: ModuleSlotMeta['state'] = 'ok',
): GaugeView {
  return only({ ...over, [GAUGE_ITEMS_KEY]: [item()] }, [{ value }], {
    [gaugeFieldKey(0, 'value')]: { state },
  })
}

describe('绑定槽的键', () => {
  it('槽键与子槽拼成 fieldKey，绑点面板与取值两侧共用这一份', () => {
    expect(gaugeFieldKey(2, 'value')).toBe(`${GAUGE_SLOT_KEY}[2].value`)
    expect(gaugeFieldKey(0, 'aux')).toBe(`${GAUGE_SLOT_KEY}[0].aux`)
  })
})

describe('仪表列表的归一化', () => {
  it('脏行不丢、只补默认——丢一行会让它之后每一条绑定改喂另一个仪表', () => {
    const items = readGaugeItems([null, { label: '流量' }, 7])

    expect(items).toHaveLength(3)
    expect(items[1]?.label).toBe('流量')
  })

  it('量程与目标收数字字符串，留空时目标是 null 而不是零', () => {
    const parsed = readGaugeItems([{ min: '10', max: '50', target: '30' }])[0]

    expect(parsed).toMatchObject({ min: 10, max: 50, target: 30 })
    expect(readGaugeItems([{}])[0]).toMatchObject({
      min: 0,
      max: 100,
      target: null,
    })
  })

  it('单位不 trim——带空格是用户显式的排版意图', () => {
    expect(readGaugeItems([{ unit: '° C' }])[0]?.unit).toBe('° C')
    expect(readGaugeItems([{ label: '  锅炉  ' }])[0]?.label).toBe('锅炉')
  })

  it('小数位取整并夹进零到六位，越界会让格式化当场抛', () => {
    expect(readGaugeItems([{ precision: 2.6 }])[0]?.precision).toBe(3)
    expect(readGaugeItems([{ precision: -1 }])[0]?.precision).toBe(0)
    expect(readGaugeItems([{ precision: 99 }])[0]?.precision).toBe(6)
  })
})

describe('四档状态', () => {
  it('逐槽结论说了算，三档各自照搬', () => {
    expect(gaugeState({ state: 'pending' }, undefined, true)).toBe('pending')
    expect(gaugeState({ state: 'error' }, undefined, true)).toBe('error')
    expect(gaugeState({ state: 'ok' }, 1, true)).toBe('ok')
  })

  it('下发了结论却没有这一槽的，就是没配来源', () => {
    expect(gaugeState(undefined, undefined, true)).toBe('unbound')
  })

  it('压根没下发结论时退回「有没有值」——设计态画布与独立挂载走这里', () => {
    expect(gaugeState(undefined, undefined, false)).toBe('unbound')
    expect(gaugeState(undefined, 0, false)).toBe('ok')
  })

  it('没配来源与等首帧显示同一个占位符，只靠修饰类分开', () => {
    const unbound = one({}, undefined, 'pending')
    const config = { [GAUGE_ITEMS_KEY]: [item()] }
    const nobody = only(config, [], {})

    expect(unbound.text).toBe('—')
    expect(nobody.text).toBe('—')
    expect(GAUGE_STATE_CLASS[unbound.state]).toBe('gc-value--pending')
    expect(GAUGE_STATE_CLASS[nobody.state]).toBe('gc-value--unbound')
  })

  it('两档的原因是两句不同的话，完整原因挂 title', () => {
    expect(reasonOf('unbound', undefined)).toBe('这个仪表还没绑定数据来源')
    expect(reasonOf('pending', undefined)).toBe('已绑定，还没收到第一帧')
    expect(reasonOf('ok', undefined)).toBe('')
  })

  it('取不到那一档带上取数侧给的原因', () => {
    expect(reasonOf('error', { state: 'error', message: '点位已下线' })).toBe(
      '取不到：点位已下线',
    )
  })

  it('有值那一档的修饰类是空串——正常读数不该多挂一个类', () => {
    expect(GAUGE_STATE_CLASS.ok).toBe('')
    expect(GAUGE_STATE_CLASS.error).toBe('gc-value--error')
  })

  it('非有值档一律不画单位、不画填充、不画 pill', () => {
    const view = one({}, undefined, 'error')

    expect(view.unit).toBe('')
    expect(view.fill).toBe('')
    expect(view.pillText).toBe('')
    expect(view.percent).toBeNull()
  })

  it('自定义占位符顶掉那一横，四档共用同一个字', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], emptyText: '待接入' },
      [],
      {},
    )

    expect(view.text).toBe('待接入')
  })
})

describe('量程到填充这条链', () => {
  it('读数落在量程里就是那个百分比，填充串直接给模板', () => {
    const view = one()

    expect(view.percent).toBe(42)
    expect(view.fill).toBe('42%')
    expect(view.dashOffset).toBe(58)
  })

  it('真实百分之零整条填充不渲染——只把宽设成零会留一小截带辉光的色块', () => {
    const view = one({}, 0)

    expect(view.percent).toBe(0)
    expect(view.fill).toBe('')
    expect(view.dashOffset).toBe(100)
  })

  it('超出量程两端各夹一次，弧不会画到缺口外面去', () => {
    expect(one({}, 500).fill).toBe('100%')
    expect(one({}, -20).fill).toBe('')
  })

  it('量程非法时百分比给 null，不伪造一个零', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ min: 100, max: 100 })] },
      [{ value: 50 }],
      { [gaugeFieldKey(0, 'value')]: { state: 'ok' } },
    )

    expect(view.percent).toBeNull()
    expect(view.fill).toBe('')
  })
})

describe('读数四档', () => {
  const config = (readout: string): Record<string, unknown> => ({
    [GAUGE_ITEMS_KEY]: [item()],
    readout,
  })
  const frame = [{ value: 42 }]
  const slots = { [gaugeFieldKey(0, 'value')]: { state: 'ok' as const } }

  it('原始值档写值、带单位', () => {
    const view = only(config('value'), frame, slots)

    expect(view.text).toBe('42')
    expect(view.percentText).toBe('')
    expect(view.unit).toBe('kW')
  })

  it('量程百分比档写百分比、不写单位——百分比没有 kW', () => {
    const view = only(config('percent'), frame, slots)

    expect(view.text).toBe('42%')
    expect(view.unit).toBe('')
  })

  it('值加百分比档把百分比缀在单位之后，两段各自成件', () => {
    const view = only(config('both'), frame, slots)

    expect(view.text).toBe('42')
    expect(view.percentText).toBe('(42%)')
    expect(view.unit).toBe('kW')
  })

  it('不显示那一档有值时整段空着，单位也不落单', () => {
    const view = only(config('none'), frame, slots)

    expect(view.text).toBe('')
    expect(view.unit).toBe('')
  })

  it('不显示那一档没有值时仍给占位符——四档状态不许被一个开关关没', () => {
    const view = only(config('none'), [], {})

    expect(view.text).toBe('—')
  })

  it('千分位跟着开关走，关了就连分隔符也不写', () => {
    const grouped = only(
      { [GAUGE_ITEMS_KEY]: [item({ max: 20000 })] },
      [{ value: 12386 }],
      slots,
    )
    const plain = only(
      { [GAUGE_ITEMS_KEY]: [item({ max: 20000 })], thousands: false },
      [{ value: 12386 }],
      slots,
    )

    expect(grouped.text).toBe('12,386')
    expect(plain.text).toBe('12386')
  })
})

describe('「万」格式与它的门槛', () => {
  const slots = { [gaugeFieldKey(0, 'value')]: { state: 'ok' as const } }
  const scale = { wanFormat: true, wanDigits: 2, ticks: true, tickCount: 4 }

  it('量程上界够一万时读数、刻度与目标标签一起换成万', () => {
    const view = only(
      {
        [GAUGE_ITEMS_KEY]: [item({ max: 50000, target: 40000 })],
        scale,
        targetMark: true,
      },
      [{ value: 12386 }],
      slots,
    )

    expect(view.text).toBe('1.24万')
    expect(view.ticks.map((tick) => tick.label)).toEqual([
      '0.00万',
      '1.67万',
      '3.33万',
      '5.00万',
    ])
    expect(view.target?.label).toBe('计划4.00万')
  })

  it('量程上界不到一万时这一个仪表整体回落——小量程走万会让刻度全塌成零点零万', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ max: 100 })], scale },
      [{ value: 42 }],
      slots,
    )

    expect(view.text).toBe('42')
    expect(view.ticks.map((tick) => tick.label)).toEqual([
      '0',
      '33',
      '67',
      '100',
    ])
  })

  it('刻度与 pill 共用一份小数位，同一张卡上不许两套口径', () => {
    const view = only(
      {
        [GAUGE_ITEMS_KEY]: [item({ max: 50000 })],
        scale: { ...scale, wanDigits: 1 },
      },
      [{ value: 12386 }],
      slots,
    )

    expect(view.ticks[3]?.label).toBe('5.0万')
    expect(view.pillText).toContain('1.2万')
  })
})

describe('刻度', () => {
  const slots = { [gaugeFieldKey(0, 'value')]: { state: 'ok' as const } }

  it('关着的时候一根都不给', () => {
    expect(one().ticks).toEqual([])
  })

  it('四根等距，首尾各占一端', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], scale: { ticks: true, tickCount: 4 } },
      [{ value: 42 }],
      slots,
    )

    expect(view.ticks.map((tick) => Math.round(tick.percent))).toEqual([
      0, 33, 67, 100,
    ])
    expect(view.ticks.map((tick) => tick.label)).toEqual([
      '0',
      '33',
      '67',
      '100',
    ])
  })

  it('首末两根换对齐基准，否则居中的那一半会溢出卡片被裁掉', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], scale: { ticks: true, tickCount: 4 } },
      [{ value: 42 }],
      slots,
    )

    expect(view.ticks.map((tick) => tick.shift)).toEqual([
      '0',
      '-50%',
      '-50%',
      '-100%',
    ])
  })

  it('根数夹进区间：一根会让分母变零，整排刻度全是 NaN 而模板照画', () => {
    const count = (ticks: unknown): number =>
      only(
        {
          [GAUGE_ITEMS_KEY]: [item()],
          scale: { ticks: true, tickCount: ticks },
        },
        [{ value: 42 }],
        slots,
      ).ticks.length

    expect(count(1)).toBe(2)
    expect(count(99)).toBe(8)
    expect(count('x')).toBe(4)
  })

  it('刻度只由量程推出来，没有读数时照画——它是表盘本身，不是读数', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], scale: { ticks: true, tickCount: 2 } },
      [],
      {},
    )

    expect(view.ticks.map((tick) => tick.label)).toEqual(['0', '100'])
  })
})

describe('量程端点', () => {
  it('关着不给，开了给两头的字', () => {
    expect(one().range).toBeNull()
    expect(
      only(
        {
          [GAUGE_ITEMS_KEY]: [item({ min: 10, max: 90 })],
          scale: { showRange: true },
        },
        [],
        {},
      ).range,
    ).toEqual({ min: '10', max: '90' })
  })
})

describe('目标标记', () => {
  const slots = { [gaugeFieldKey(0, 'value')]: { state: 'ok' as const } }

  it('开关关着就不画，哪怕配了目标', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ target: 80 })] },
      [{ value: 42 }],
      slots,
    )

    expect(view.target).toBeNull()
  })

  it('落点走量程归一，标签是前缀加目标值', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ target: 80 })], targetMark: true },
      [{ value: 42 }],
      slots,
    )

    expect(view.target).toEqual({
      percent: 80,
      label: '计划80',
      shift: '-50%',
    })
  })

  it('绑了目标槽就顶掉行内那个静态值——设定值改了墙上跟着变', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ target: 80 })], targetMark: true },
      [{ value: 42, aux: 30 }],
      slots,
    )

    expect(view.target?.percent).toBe(30)
  })

  it('目标贴到两端时换对齐基准', () => {
    const at = (target: number): string | undefined =>
      only(
        { [GAUGE_ITEMS_KEY]: [item({ target })], targetMark: true },
        [{ value: 42 }],
        slots,
      ).target?.shift

    expect(at(0)).toBe('0')
    expect(at(100)).toBe('-100%')
  })

  it('量程非法时不画标记——伪造一个落点比不画更难发现', () => {
    const view = only(
      {
        [GAUGE_ITEMS_KEY]: [item({ min: 100, max: 100, target: 80 })],
        targetMark: true,
      },
      [{ value: 42 }],
      slots,
    )

    expect(view.target).toBeNull()
  })

  it('两处都没有目标时不画标记，也不把标签写成一个前缀', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], targetMark: true },
      [{ value: 42 }],
      slots,
    )

    expect(view.target).toBeNull()
  })
})

describe('轨道内的 pill', () => {
  const slots = { [gaugeFieldKey(0, 'value')]: { state: 'ok' as const } }

  it('完成率可以超过一百，而填充宽度另用夹过的那个数', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ target: 80 })] },
      [{ value: 96 }],
      slots,
    )

    expect(view.pillText).toBe('96kW (120.0%)')
    expect(view.fill).toBe('96%')
  })

  it('关掉完成率就只剩读数与单位', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item({ target: 80 })], showPercent: false },
      [{ value: 96 }],
      slots,
    )

    expect(view.pillText).toBe('96kW')
  })

  it('目标缺席时完成率退回量程占比，不因为除零显成一点没完成', () => {
    const view = only({ [GAUGE_ITEMS_KEY]: [item()] }, [{ value: 96 }], slots)

    expect(view.pillText).toBe('96kW (96.0%)')
  })
})

describe('值规则命中', () => {
  const slots = { [gaugeFieldKey(0, 'value')]: { state: 'ok' as const } }
  const rules = [
    {
      op: 'gt',
      value: 90,
      level: 'danger',
      color: 'var(--state-danger)',
      label: '超限',
      blink: true,
    },
  ]

  it('命中时文案顶掉标签、颜色摊进变量、跟着闪', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], rules },
      [{ value: 95 }],
      slots,
    )

    expect(view.label).toBe('超限')
    expect(view.labelIsHit).toBe(true)
    expect(view.blink).toBe(true)
    expect(view.vars['--gc-item-color']).toBe('var(--state-danger)')
  })

  it('没命中就用行内标签，一个变量都不注入', () => {
    const view = only(
      { [GAUGE_ITEMS_KEY]: [item()], rules },
      [{ value: 42 }],
      slots,
    )

    expect(view.label).toBe('主蒸汽压力')
    expect(view.labelIsHit).toBe(false)
    expect(view.vars).toEqual({})
  })

  it('逐个仪表的静态色照旧注入，命中时被命中色压过去', () => {
    const config = {
      [GAUGE_ITEMS_KEY]: [item({ color: 'var(--accent-secondary)' })],
      rules,
    }

    expect(only(config, [{ value: 42 }], slots).vars['--gc-item-color']).toBe(
      'var(--accent-secondary)',
    )
    expect(only(config, [{ value: 95 }], slots).vars['--gc-item-color']).toBe(
      'var(--state-danger)',
    )
  })

  it('非有值档一律不评估规则：断了的仪表不该亮成告警', () => {
    const view = only({ [GAUGE_ITEMS_KEY]: [item()], rules }, [], {})

    expect(view.blink).toBe(false)
    expect(view.vars).toEqual({})
  })
})

describe('列表键与文档序', () => {
  it('两个完全同配置的仪表也拿到不同的键', () => {
    const views = build({ [GAUGE_ITEMS_KEY]: [item(), item()] })

    expect(views[0]?.key).not.toBe(views[1]?.key)
    expect(views.map((view) => view.index)).toEqual([0, 1])
  })

  it('键只由身份派生，读数变了键不变', () => {
    const config = { [GAUGE_ITEMS_KEY]: [item()] }

    expect(only(config, [{ value: 1 }], {}).key).toBe(
      only(config, [{ value: 2 }], {}).key,
    )
  })

  it('一项都没有时摊出空表，不抛', () => {
    expect(build({})).toEqual([])
    expect(build({ [GAUGE_ITEMS_KEY]: '不是数组' })).toEqual([])
  })
})
