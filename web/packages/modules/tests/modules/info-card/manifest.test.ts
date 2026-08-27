/**
 * @fileoverview 守信息卡片清单的声明：字段预算（顶层 33 / 行内 10）、每个簇都有整块缺省
 * 且子键顺序就是预设的基准、没有第三层容器字段、枚举档位取自本模块那张取值表而不是手抄、
 * 两个绑定子槽逐字对上、行钉在配置里的格上、四档状态由模块自己交代。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  CARD_ITEMS_KEY,
  CARD_SLOT_KEY,
} from '../../../src/modules/info-card/cells'
import manifest from '../../../src/modules/info-card/manifest'
import {
  CARD_COLUMNS,
  CARD_ICON_MODES,
  CARD_LABEL_PLACES,
  CARD_LAYOUTS,
  CARD_UNIT_PLACES,
  CARD_VALUE_KINDS,
} from '../../../src/modules/info-card/options'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(CARD_ITEMS_KEY)?.itemSchema ?? []
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

describe('信息卡片清单的身份', () => {
  it('是数据类的多点位展示模块，吃平台那套统一卡片外观', () => {
    expect(manifest.type).toBe('info-card')
    expect(manifest.displayName).toBe('信息卡片')
    expect(manifest.category).toBe('数据')
    expect(manifest.icon).toBe('layout-grid')
    // 缺省就是 card：自绘标题条的模块才需要声明，声明了反而画出两层框
    expect(manifest.chrome).toBeUndefined()
    expect(manifest.chromeConfigurable).toBeUndefined()
    // 标题栏交给 ModulePanel，四十个外观键一个都不挑
    expect(manifest.unsupportedChromeKeys).toBeUndefined()
  })

  it('默认尺寸摆得下两行小卡，最小尺寸仍留得住一个读数', () => {
    expect(manifest.defaultSize).toEqual({
      width: 420,
      height: 220,
      minWidth: 120,
      minHeight: 64,
    })
  })

  it('逐格自己交代取数状态，并按格上抛联动值', () => {
    // ⚠ 不开的话，十格里坏掉一格会让整块被浮层盖住，另外九格一个都看不见
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
    // 缺省就是 ['click']，声明一遍只会多一处要同步的地方
    expect(manifest.interactionEvents).toBeUndefined()
  })
})

describe('信息卡片的字段预算', () => {
  it('顶层三十三个字段，键唯一', () => {
    expect(SCHEMA).toHaveLength(33)
    expect(TOP_KEYS.size).toBe(33)
  })

  it('三十三个字段分段摆开，每一段的字段数就是设计里的那份预算', () => {
    const counts = new Map<string, number>()
    for (const item of SCHEMA) {
      const group = item.group ?? ''
      counts.set(group, (counts.get(group) ?? 0) + 1)
    }

    expect([...counts]).toEqual([
      ['内容', 3],
      ['排布', 6],
      ['外壳', 4],
      ['标签', 5],
      ['数值', 8],
      ['单位', 1],
      ['格式', 2],
      ['图标', 1],
      ['对比', 1],
      ['告警', 2],
    ])
  })

  it('行内十个字段，键唯一', () => {
    const keys = itemFields().map((item) => item.key)

    expect(keys).toEqual([
      'label',
      'unit',
      'precision',
      'valueKind',
      'trueText',
      'falseText',
      'emoji',
      'icon',
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

  it('图标字段只写 type，不写契约里没有的 assetKind', () => {
    expect(subField(CARD_ITEMS_KEY, 'icon')).toEqual({
      key: 'icon',
      label: '素材图标',
      type: 'image',
      default: '',
      help: expect.any(String) as string,
    })
  })
})

describe('信息卡片的缺省', () => {
  it('每个顶层字段都有缺省，摊得出一份完整配置', () => {
    const missing = SCHEMA.filter((item) => item.default === undefined).map(
      (item) => item.key,
    )

    expect(missing).toEqual([])
  })

  it('行内十个字段也都有缺省，没有「留空 = 不判」的量程键', () => {
    const missing = itemFields()
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })

  it('每个簇都有整块缺省，键集合与子字段逐字相同（含顺序）', () => {
    const drift = objectFields()
      .map((item) => ({
        key: item.key,
        onField: defaultKeys(item.default),
        onFields: (item.fields ?? []).map((child) => child.key),
      }))
      .filter((row) => row.onField.join() !== row.onFields.join())

    expect(objectFields().map((item) => item.key)).toEqual([
      'unit',
      'icon',
      'compare',
    ])
    expect(drift).toEqual([])
  })

  it('图标那一簇十二个子键，角标与图标容器共用同一套旋钮', () => {
    expect(defaultKeys(field('icon')?.default)).toEqual([
      'mode',
      'position',
      'size',
      'shape',
      'bgFrom',
      'bgTo',
      'bgAngle',
      'borderColor',
      'glow',
      'gap',
      'fontSize',
      'opacity',
    ])
  })

  it('单位四个子键、涨跌块四个子键', () => {
    expect(defaultKeys(field('unit')?.default)).toEqual([
      'place',
      'size',
      'tone',
      'opacity',
    ])
    expect(defaultKeys(field('compare')?.default)).toEqual([
      'show',
      'mode',
      'label',
      'invertTrend',
    ])
  })

  it('图标底色与描边缺省留空——那三个参考仓 token 本仓没有，填进去等于把底画没', () => {
    expect(field('icon')?.default).toMatchObject({
      bgFrom: '',
      bgTo: '',
      borderColor: '',
    })
  })

  it('读数字号缺省是自适应那一档的哨兵零，不是某个具体字号', () => {
    expect(field('valueSize')?.default).toBe(0)
    expect(field('valueSize')?.min).toBe(0)
    expect(field('valueSize')?.max).toBe(200)
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

describe('信息卡片的枚举档位来自那张取值表', () => {
  it('清单摊的就是取值表本身，不是另手抄的一份', () => {
    expect(optionValues(field('layout'))).toEqual(
      CARD_LAYOUTS.map((option) => option.value),
    )
    expect(optionValues(field('labelPlace'))).toEqual(
      CARD_LABEL_PLACES.map((option) => option.value),
    )
    expect(optionValues(subField('unit', 'place'))).toEqual(
      CARD_UNIT_PLACES.map((option) => option.value),
    )
    expect(optionValues(subField('icon', 'mode'))).toEqual(
      CARD_ICON_MODES.map((option) => option.value),
    )
    expect(optionValues(subField(CARD_ITEMS_KEY, 'valueKind'))).toEqual(
      CARD_VALUE_KINDS.map((option) => option.value),
    )
  })

  it('列数的档值一律是字符串——写成数字判不中白名单，墙上静默少了列数', () => {
    const values = optionValues(field('columns'))

    expect(values).toEqual(CARD_COLUMNS.map((option) => option.value))
    expect(values.every((value) => typeof value === 'string')).toBe(true)
  })
})

describe('信息卡片的条件显示', () => {
  it('渐变的两个旋钮只在渐变档露出来', () => {
    expect(field('valueGradient')).toMatchObject({
      when: { key: 'valueFill', in: ['gradient'] },
    })
    expect(field('gradientAngle')).toMatchObject({
      when: { key: 'valueFill', in: ['gradient'] },
    })
  })

  it('每条条件显示都指着一个真存在的同级字段', () => {
    const dangling = SCHEMA.filter((item) => item.when !== undefined)
      .filter((item) => !TOP_KEYS.has(item.when?.key ?? ''))
      .map((item) => item.key)

    expect(dangling).toEqual([])
  })

  it('行内的两句开关量文案只在开关量档露出来，指的也是行内的同级字段', () => {
    const keys = new Set(itemFields().map((item) => item.key))
    const conditional = itemFields().filter((item) => item.when !== undefined)

    expect(conditional.map((item) => item.key)).toEqual([
      'trueText',
      'falseText',
    ])
    expect(
      conditional.filter((item) => !keys.has(item.when?.key ?? '')),
    ).toEqual([])
    expect(conditional[0]?.when).toEqual({ key: 'valueKind', in: ['boolean'] })
  })
})

describe('信息卡片的绑定槽', () => {
  it('只有一个数组槽，格钉在配置里的项上', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(slot()?.key).toBe(CARD_SLOT_KEY)
    expect(slot()?.dataType).toBe('number')
    expect(slot()?.isArray).toBe(true)
    // ⚠ 漏了它，服务端会套「索引连续且从 0 起」，「配了十格只绑第二个」直接存不下去
    expect(slot()?.isEntityPinned).toBe(true)
  })

  it('两个子槽逐字对上：一个主读数 + 一个对比值', () => {
    expect((slot()?.arrayFields ?? []).map((item) => item.key)).toEqual([
      'value',
      'aux',
    ])
  })

  it('一个子槽都不必绑，也一个都不是时序槽、不带枚举映射', () => {
    const specs = [...manifest.bindings, ...(slot()?.arrayFields ?? [])]

    // ⚠ 给了 isRequired 会让整块被判 unbound 并盖上浮层，逐格四档白画
    expect(specs.filter((item) => item.isRequired !== undefined)).toEqual([])
    expect(specs.filter((item) => item.isTimeSeries !== undefined)).toEqual([])
    expect(specs.filter((item) => item.enumMap !== undefined)).toEqual([])
  })
})

describe('信息卡片派生的绑点行', () => {
  it('行数跟着配置里的格走，一格都没有时给的是 0 而不是漏掉这个键', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [CARD_SLOT_KEY]: 0 })
    expect(
      manifest.bindingRowCounts?.({
        [CARD_ITEMS_KEY]: [{ label: '甲' }, { label: '乙' }],
      }),
    ).toEqual({ [CARD_SLOT_KEY]: 2 })
  })

  it('脏行不丢：丢一格会让它之后每一条绑定改喂前一格，而界面上一切正常', () => {
    expect(
      manifest.bindingRowCounts?.({ [CARD_ITEMS_KEY]: [{}, '不是一行', 7] }),
    ).toEqual({ [CARD_SLOT_KEY]: 3 })
  })

  it('行名挂在这一格第一个子槽的 fieldKey 上，并带一份可核对的标识', () => {
    const labels = manifest.bindingRowLabels?.({
      [CARD_ITEMS_KEY]: [{ label: '瞬时流量', emitValue: 'flow-1' }],
    })

    expect(Object.keys(labels ?? {})).toEqual([`${CARD_SLOT_KEY}[0].value`])
    expect(labels?.[`${CARD_SLOT_KEY}[0].value`]).toEqual({
      title: expect.stringContaining('瞬时流量') as string,
      id: 'flow-1',
    })
  })

  it('没配名称的格在绑点面板上仍按格号称呼，不是一串没有名字的行', () => {
    // ⚠ 墙上没有标签行不等于绑点面板上也没有名字：那份名单全靠数行号认对象
    const labels = manifest.bindingRowLabels?.({
      [CARD_ITEMS_KEY]: [{ label: '' }, { label: '' }],
    })

    expect(labels?.[`${CARD_SLOT_KEY}[1].value`]).toEqual({
      title: '第 2 格',
      id: '',
    })
  })
})

describe('信息卡片的画布预览', () => {
  it('预览只提清单里有的键，且演示格数与演示读数对得上', () => {
    const config = manifest.preview?.config ?? {}
    const values = manifest.preview?.values ?? {}
    const cells = config[CARD_ITEMS_KEY]
    const readings = values[CARD_SLOT_KEY]

    expect(Object.keys(config)).toEqual([CARD_ITEMS_KEY])
    expect(Object.keys(values)).toEqual([CARD_SLOT_KEY])
    expect(Array.isArray(cells) && Array.isArray(readings)).toBe(true)
    expect((cells as unknown[]).length).toBe((readings as unknown[]).length)
  })
})
