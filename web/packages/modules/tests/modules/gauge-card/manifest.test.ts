/**
 * @fileoverview 守仪表卡片清单的声明：字段预算（顶层 30 / 行内 8）、两个簇都有整块缺省
 * 且子键顺序就是预设的基准、量程与厚度的区间与取值层共用一份、目标值刻意没有缺省、
 * 枚举档位取自本模块那张取值表而不是手抄、两个绑定子槽逐字对上、行钉在配置里的仪表上。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  GAUGE_ARC_SPAN_DEFAULT,
  GAUGE_ARC_SPAN_MAX,
  GAUGE_ARC_SPAN_MIN,
  GAUGE_TICK_COUNT_DEFAULT,
  GAUGE_TICK_COUNT_MAX,
  GAUGE_TICK_COUNT_MIN,
} from '../../../src/modules/gauge-card/geometry'
import {
  GAUGE_ITEMS_KEY,
  GAUGE_SLOT_KEY,
} from '../../../src/modules/gauge-card/gauges'
import { GAUGE_SIZE_BOUNDS } from '../../../src/modules/gauge-card/look'
import manifest from '../../../src/modules/gauge-card/manifest'
import {
  GAUGE_COLUMNS,
  GAUGE_FILL_STYLES,
  GAUGE_LABEL_PLACES,
  GAUGE_LABEL_TONES,
  GAUGE_LAYOUTS,
  GAUGE_READOUT_PLACES,
  GAUGE_READOUTS,
  GAUGE_SHAPES,
  GAUGE_THICKNESS_MAX,
  GAUGE_UNIT_PLACES,
} from '../../../src/modules/gauge-card/options'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(GAUGE_ITEMS_KEY)?.itemSchema ?? []
}

function subField(parent: string, key: string): ConfigField | undefined {
  const owner = field(parent)
  return [...(owner?.fields ?? []), ...(owner?.itemSchema ?? [])].find(
    (item) => item.key === key,
  )
}

function objectFields(): readonly ConfigField[] {
  return SCHEMA.filter((item) => item.type === 'object')
}

function defaultKeys(value: unknown): string[] {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.keys(value)
    : []
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

/** 每个「自己还带子容器」的字段所在的层级；面板从 0 起算，每下一层 +1。 */
function containerDepths(fields: readonly ConfigField[], depth = 0): number[] {
  return fields.flatMap((item) => {
    const children = item.fields ?? item.itemSchema
    if (children === undefined) return []
    return [depth, ...containerDepths(children, depth + 1)]
  })
}

/** 顶层、簇内与行内的全部字段，枚举类的通检要走遍这三层。 */
function everyField(): ConfigField[] {
  return [
    ...SCHEMA,
    ...SCHEMA.flatMap((item) => [
      ...(item.fields ?? []),
      ...(item.itemSchema ?? []),
    ]),
  ]
}

function slot(): BindingSpec | undefined {
  return manifest.bindings[0]
}

describe('仪表卡片清单的身份', () => {
  it('是数据类的多点位展示模块，吃平台那套统一卡片外观', () => {
    expect(manifest.type).toBe('gauge-card')
    expect(manifest.displayName).toBe('仪表卡片')
    expect(manifest.category).toBe('数据')
    expect(manifest.icon).toBe('gauge')
    // 缺省就是 card：自绘标题条的模块才需要声明，声明了反而画出两层框
    expect(manifest.chrome).toBeUndefined()
    expect(manifest.chromeConfigurable).toBeUndefined()
    // ⚠ 参考仓 target-progress 自绘 .tp-head 导致宿主标题栏永远不出；
    //   这里标题交给 ModulePanel，四十个外观键一个都不挑
    expect(manifest.unsupportedChromeKeys).toBeUndefined()
  })

  it('默认尺寸摆得下一个弧度盘，最小尺寸仍留得住一条横向条', () => {
    expect(manifest.defaultSize).toEqual({
      width: 320,
      height: 220,
      minWidth: 120,
      minHeight: 96,
    })
  })

  it('逐个仪表自己交代取数状态，并按仪表上抛联动值', () => {
    // ⚠ 不开的话，六个仪表里坏掉一个会让整块被浮层盖住，另外五个一个都看不见
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
    // 缺省就是 ['click']，声明一遍只会多一处要同步的地方
    expect(manifest.interactionEvents).toBeUndefined()
  })
})

describe('仪表卡片的字段预算', () => {
  it('顶层三十二个字段，键唯一', () => {
    expect(SCHEMA).toHaveLength(32)
    expect(TOP_KEYS.size).toBe(32)
  })

  it('三十二个字段分段摆开，每一段的字段数就是设计里的那份预算', () => {
    const counts = new Map<string, number>()
    for (const item of SCHEMA) {
      const group = item.group ?? ''
      counts.set(group, (counts.get(group) ?? 0) + 1)
    }

    expect([...counts]).toEqual([
      ['内容', 3],
      ['排布', 5],
      ['几何', 5],
      ['刻度', 2],
      ['目标', 3],
      ['读数', 5],
      ['单位', 2],
      ['标签', 3],
      ['配色', 2],
      ['格式', 1],
      ['告警', 1],
    ])
  })

  it('行内八个字段，键唯一', () => {
    const keys = itemFields().map((item) => item.key)

    expect(keys).toEqual([
      'label',
      'unit',
      'precision',
      'min',
      'max',
      'target',
      'color',
      'emitValue',
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('没有第三层容器字段——真降级时面板只是悄悄换成一个 JSON 文本框', () => {
    const depths = containerDepths(SCHEMA)

    expect(depths.length).toBeGreaterThan(0)
    expect(depths.filter((depth) => depth >= 3)).toEqual([])
  })
})

describe('仪表卡片的缺省', () => {
  it('每个顶层字段都有缺省，摊得出一份完整配置', () => {
    const missing = SCHEMA.filter((item) => item.default === undefined).map(
      (item) => item.key,
    )

    expect(missing).toEqual([])
  })

  it('行内只有目标值刻意没有缺省：留空 = 不画标记、完成率退回按量程算', () => {
    const missing = itemFields()
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    // ⚠ 给它补个 0 会让完成率一路除零，而屏上只是数字不对
    expect(missing).toEqual(['target'])
  })

  it('量程两端都有缺省，与两个参考模块的零到一百逐字相同', () => {
    expect(subField(GAUGE_ITEMS_KEY, 'min')?.default).toBe(0)
    expect(subField(GAUGE_ITEMS_KEY, 'max')?.default).toBe(100)
  })

  it('两个簇都有整块缺省，键集合与子字段逐字相同（含顺序）', () => {
    const drift = objectFields()
      .map((item) => ({
        key: item.key,
        onField: defaultKeys(item.default),
        onFields: (item.fields ?? []).map((child) => child.key),
      }))
      .filter((row) => row.onField.join() !== row.onFields.join())

    expect(objectFields().map((item) => item.key)).toEqual([
      'geometry',
      'scale',
    ])
    expect(drift).toEqual([])
  })

  it('尺寸簇五个子键，五档几何各吃其中一段', () => {
    expect(defaultKeys(field('geometry')?.default)).toEqual([
      'thickness',
      'arcSpan',
      'tankWidth',
      'tubeWidth',
      'bulbSize',
    ])
    expect(field('geometry')?.default).toEqual({
      thickness: 0,
      arcSpan: GAUGE_ARC_SPAN_DEFAULT,
      tankWidth: GAUGE_SIZE_BOUNDS.tankWidth.fallback,
      tubeWidth: GAUGE_SIZE_BOUNDS.tubeWidth.fallback,
      bulbSize: GAUGE_SIZE_BOUNDS.bulbSize.fallback,
    })
  })

  it('刻度簇五个子键，「万」格式与它的小数位同住一处', () => {
    expect(defaultKeys(field('scale')?.default)).toEqual([
      'showRange',
      'ticks',
      'tickCount',
      'wanFormat',
      'wanDigits',
    ])
    expect(field('scale')?.default).toEqual({
      showRange: false,
      ticks: false,
      tickCount: GAUGE_TICK_COUNT_DEFAULT,
      wanFormat: false,
      wanDigits: 2,
    })
  })

  it('厚度的下界是哨兵零而不是二——拖不到零就再也回不去「随几何档」', () => {
    const thickness = subField('geometry', 'thickness')

    expect(thickness?.default).toBe(0)
    expect(thickness?.min).toBe(0)
    expect(thickness?.max).toBe(GAUGE_THICKNESS_MAX)
  })

  it('张角与刻度个数的区间就是几何那份常量，不是另手抄的一份', () => {
    expect([
      subField('geometry', 'arcSpan')?.min,
      subField('geometry', 'arcSpan')?.max,
    ]).toEqual([GAUGE_ARC_SPAN_MIN, GAUGE_ARC_SPAN_MAX])
    expect([
      subField('scale', 'tickCount')?.min,
      subField('scale', 'tickCount')?.max,
    ]).toEqual([GAUGE_TICK_COUNT_MIN, GAUGE_TICK_COUNT_MAX])
  })

  it('罐宽、管宽、球径的区间与取值层共用一份——各写一遍会「拖到头了还在变小」', () => {
    const bounds = [
      ['tankWidth', GAUGE_SIZE_BOUNDS.tankWidth],
      ['tubeWidth', GAUGE_SIZE_BOUNDS.tubeWidth],
      ['bulbSize', GAUGE_SIZE_BOUNDS.bulbSize],
    ] as const
    const drift = bounds
      .map(([key, bound]) => ({
        key,
        panel: [
          subField('geometry', key)?.min,
          subField('geometry', key)?.max,
          subField('geometry', key)?.default,
        ],
        look: [bound.min, bound.max, bound.fallback],
      }))
      .filter((row) => row.panel.join() !== row.look.join())

    expect(drift).toEqual([])
  })

  it('读数字号缺省是自适应那一档的哨兵零，不是某个具体字号', () => {
    expect(field('valueSize')?.default).toBe(0)
    expect(field('valueSize')?.min).toBe(0)
    expect(field('valueSize')?.max).toBe(200)
  })

  it('千分位缺省是开着的——两个参考模块都走 toLocaleString 且没关分组', () => {
    expect(field('thousands')?.default).toBe(true)
  })

  it('每个枚举字段的缺省都落在自己的选项里，簇内与行内也一样', () => {
    const stray = everyField()
      .filter((item) => item.type === 'enum')
      .filter(
        (item) =>
          !(item.options ?? []).some((option) => option.value === item.default),
      )
      .map((item) => item.key)

    expect(stray).toEqual([])
  })

  it('每个枚举字段都真给了选项，且取值不重复', () => {
    const broken = everyField()
      .filter((item) => item.type === 'enum')
      .map((item) => (item.options ?? []).map((option) => option.value))
      .filter(
        (values) =>
          values.length === 0 || new Set(values).size !== values.length,
      )

    expect(broken).toEqual([])
  })
})

describe('仪表卡片的枚举档位来自那张取值表', () => {
  it('清单摊的就是取值表本身，不是另手抄的一份', () => {
    expect(optionValues(field('layout'))).toEqual(
      GAUGE_LAYOUTS.map((option) => option.value),
    )
    expect(optionValues(field('shape'))).toEqual(
      GAUGE_SHAPES.map((option) => option.value),
    )
    expect(optionValues(field('fillStyle'))).toEqual(
      GAUGE_FILL_STYLES.map((option) => option.value),
    )
    expect(optionValues(field('readout'))).toEqual(
      GAUGE_READOUTS.map((option) => option.value),
    )
    expect(optionValues(field('readoutPlace'))).toEqual(
      GAUGE_READOUT_PLACES.map((option) => option.value),
    )
    expect(optionValues(field('unitPlace'))).toEqual(
      GAUGE_UNIT_PLACES.map((option) => option.value),
    )
    expect(optionValues(field('labelTone'))).toEqual(
      GAUGE_LABEL_TONES.map((option) => option.value),
    )
  })

  it('标签位置四档，没有「隐藏」那一档——藏标签是把这一项的名称留空', () => {
    expect(optionValues(field('labelPlace'))).toEqual(
      GAUGE_LABEL_PLACES.map((option) => option.value),
    )
    expect(optionValues(field('labelPlace'))).not.toContain('hidden')
  })

  it('列数的档值一律是字符串——写成数字判不中白名单，墙上静默少了列数', () => {
    const values = optionValues(field('columns'))

    expect(values).toEqual(GAUGE_COLUMNS.map((option) => option.value))
    expect(values.every((value) => typeof value === 'string')).toBe(true)
  })
})

describe('仪表卡片的条件显示', () => {
  it('顶层与行内一条条件显示都不摆——五档几何靠说明分工，不靠隐藏', () => {
    // ⚠ 簇内子字段的条件显示判的是**簇内**同级取值，判不到顶层的几何档：
    //   给尺寸子键挂 when 会一条都不生效，而面板上看不出来
    expect(SCHEMA.filter((item) => item.when !== undefined)).toEqual([])
    expect(itemFields().filter((item) => item.when !== undefined)).toEqual([])
    expect(
      objectFields().flatMap((item) =>
        (item.fields ?? []).filter((child) => child.when !== undefined),
      ),
    ).toEqual([])
  })

  it('五个尺寸子键各自说明哪一档吃它——摆着不生效的那几个只能靠说明认', () => {
    const thin = (field('geometry')?.fields ?? []).filter(
      (item) => (item.help ?? '') === '',
    )

    expect(thin).toEqual([])
  })

  it('规则行里的阈值上界仍按同级的运算符档露出来', () => {
    expect(subField('rules', 'value2')?.when).toEqual({
      key: 'op',
      in: ['between', 'outside'],
    })
  })
})

describe('仪表卡片的绑定槽', () => {
  it('只有一个数组槽，行钉在配置里的仪表上', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(slot()?.key).toBe(GAUGE_SLOT_KEY)
    expect(slot()?.dataType).toBe('number')
    expect(slot()?.isArray).toBe(true)
    // ⚠ 漏了它，服务端会套「索引连续且从 0 起」，「配了六个只绑第二个」直接存不下去
    expect(slot()?.isEntityPinned).toBe(true)
  })

  it('两个子槽逐字对上：一个主读数 + 一个目标实际值', () => {
    expect((slot()?.arrayFields ?? []).map((item) => item.key)).toEqual([
      'value',
      'aux',
    ])
  })

  it('一个子槽都不必绑，也一个都不是时序槽、不带枚举映射', () => {
    const specs = [...manifest.bindings, ...(slot()?.arrayFields ?? [])]

    // ⚠ 给了 isRequired 会让整块被判 unbound 并盖上浮层，逐个四档白画
    expect(specs.filter((item) => item.isRequired !== undefined)).toEqual([])
    expect(specs.filter((item) => item.isTimeSeries !== undefined)).toEqual([])
    expect(specs.filter((item) => item.enumMap !== undefined)).toEqual([])
  })
})

describe('仪表卡片派生的绑点行', () => {
  it('行数跟着配置里的仪表走，一个都没有时给的是 0 而不是漏掉这个键', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [GAUGE_SLOT_KEY]: 0 })
    expect(
      manifest.bindingRowCounts?.({
        [GAUGE_ITEMS_KEY]: [{ label: '甲' }, { label: '乙' }],
      }),
    ).toEqual({ [GAUGE_SLOT_KEY]: 2 })
  })

  it('脏行不丢：丢一个会让它之后每一条绑定改喂前一个，而界面上一切正常', () => {
    expect(
      manifest.bindingRowCounts?.({ [GAUGE_ITEMS_KEY]: [{}, '不是一行', 7] }),
    ).toEqual({ [GAUGE_SLOT_KEY]: 3 })
  })

  it('行名挂在这一个仪表第一个子槽的 fieldKey 上，并带一份可核对的标识', () => {
    const labels = manifest.bindingRowLabels?.({
      [GAUGE_ITEMS_KEY]: [{ label: '瞬时流量', emitValue: 'flow-1' }],
    })

    expect(Object.keys(labels ?? {})).toEqual([`${GAUGE_SLOT_KEY}[0].value`])
    expect(labels?.[`${GAUGE_SLOT_KEY}[0].value`]).toEqual({
      title: expect.stringContaining('瞬时流量') as string,
      id: 'flow-1',
    })
  })

  it('没配名称的仪表在绑点面板上仍按序号称呼，不是一串没有名字的行', () => {
    // ⚠ 墙上没有标签不等于绑点面板上也没有名字：那份名单全靠数行号认对象
    const labels = manifest.bindingRowLabels?.({
      [GAUGE_ITEMS_KEY]: [{ label: '' }, { label: '' }],
    })

    expect(labels?.[`${GAUGE_SLOT_KEY}[1].value`]).toEqual({
      title: '第 2 个仪表',
      id: '',
    })
  })
})

describe('仪表卡片的画布预览', () => {
  it('预览只提清单里有的键，且演示仪表数与演示读数对得上', () => {
    const config = manifest.preview?.config ?? {}
    const values = manifest.preview?.values ?? {}
    const gauges = config[GAUGE_ITEMS_KEY]
    const readings = values[GAUGE_SLOT_KEY]

    expect(Object.keys(config)).toEqual([GAUGE_ITEMS_KEY])
    expect(Object.keys(values)).toEqual([GAUGE_SLOT_KEY])
    expect(Array.isArray(gauges) && Array.isArray(readings)).toBe(true)
    expect((gauges as unknown[]).length).toBe((readings as unknown[]).length)
  })

  it('演示读数落在演示量程里，画出来才是一条填了一多半的仪表', () => {
    const gauges = (manifest.preview?.config?.[GAUGE_ITEMS_KEY] ??
      []) as Record<string, unknown>[]
    const readings = (manifest.preview?.values?.[GAUGE_SLOT_KEY] ??
      []) as Record<string, unknown>[]
    const first = gauges[0] ?? {}
    const reading = readings[0] ?? {}

    expect(typeof reading.value).toBe('number')
    expect(Number(reading.value)).toBeGreaterThan(Number(first.min))
    expect(Number(reading.value)).toBeLessThan(Number(first.max))
  })
})
