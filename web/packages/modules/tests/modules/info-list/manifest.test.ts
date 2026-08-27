/**
 * @fileoverview 守信息列表清单的声明：字段预算（顶层 35 / 行内 10）、每个簇都有
 * 整块缺省且子键顺序就是预设的基准、刻意没有缺省的那几个量程键、没有第三层容器
 * 字段、十一个绑定子槽逐字对上、`status` 子槽刻意不带 enumMap、四档状态由模块自己
 * 交代。这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/info-list/manifest'
import {
  LIST_ITEMS_KEY,
  LIST_SLOT_KEY,
} from '../../../src/modules/info-list/rows'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function itemFields(): readonly ConfigField[] {
  return field(LIST_ITEMS_KEY)?.itemSchema ?? []
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

/** 每个「自己还带子容器」的字段所在的层级；面板从 0 起算，每下一层 +1。 */
function containerDepths(fields: readonly ConfigField[], depth = 0): number[] {
  return fields.flatMap((item) => {
    const children = item.fields ?? item.itemSchema
    if (children === undefined) return []
    return [depth, ...containerDepths(children, depth + 1)]
  })
}

function slot(): BindingSpec | undefined {
  return manifest.bindings[0]
}

describe('信息列表清单的身份', () => {
  it('是数据类的多点位展示模块，吃平台那套统一卡片外观', () => {
    expect(manifest.type).toBe('info-list')
    expect(manifest.displayName).toBe('信息列表')
    expect(manifest.category).toBe('数据')
    expect(manifest.icon).toBe('table')
    // 缺省就是 card：自绘标题条的模块才需要声明，声明了反而画出两层框
    expect(manifest.chrome).toBeUndefined()
    expect(manifest.chromeConfigurable).toBeUndefined()
    // 标题栏交给 ModulePanel，四十个外观键一个都不挑
    expect(manifest.unsupportedChromeKeys).toBeUndefined()
  })

  it('默认尺寸摆得下一屏行，最小尺寸仍留得住一行', () => {
    expect(manifest.defaultSize).toEqual({
      width: 360,
      height: 420,
      minWidth: 160,
      minHeight: 96,
    })
  })

  it('逐行自己交代取数状态，并按行上抛联动值', () => {
    // ⚠ 不开的话，十行里坏掉一行会让整块被浮层盖住，另外九行一个都看不见
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
    // 缺省就是 ['click']，声明一遍只会多一处要同步的地方
    expect(manifest.interactionEvents).toBeUndefined()
  })
})

describe('信息列表的字段预算', () => {
  it('顶层三十五个字段，键唯一', () => {
    expect(SCHEMA).toHaveLength(35)
    expect(TOP_KEYS.size).toBe(35)
  })

  it('行内十个字段，键唯一', () => {
    const keys = itemFields().map((item) => item.key)

    expect(keys).toEqual([
      'label',
      'unit',
      'precision',
      'tag',
      'group',
      'color',
      'icon',
      'range',
      'desc',
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
    expect(subField(LIST_ITEMS_KEY, 'icon')).toEqual({
      key: 'icon',
      label: '行首图标',
      type: 'image',
      default: '',
      help: expect.any(String) as string,
    })
  })
})

describe('信息列表的缺省', () => {
  it('每个顶层字段都有缺省，摊得出一份完整配置', () => {
    const missing = SCHEMA.filter((item) => item.default === undefined).map(
      (item) => item.key,
    )

    expect(missing).toEqual([])
  })

  it('行内除量程外都有缺省', () => {
    const missing = itemFields()
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual(['range'])
  })

  it('量程的三个子键刻意没有缺省——留空是「不判」，给 0 就与真实 0 分不开', () => {
    const range = subField(LIST_ITEMS_KEY, 'range')
    const bounds = (range?.fields ?? []).map((item) => ({
      key: item.key,
      hasDefault: item.default !== undefined,
    }))

    expect(bounds).toEqual([
      { key: 'min', hasDefault: false },
      { key: 'max', hasDefault: false },
      { key: 'target', hasDefault: false },
    ])
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
      'rowShape',
      'columnHeader',
      'spacing',
      'badge',
      'meter',
    ])
    expect(drift).toEqual([])
  })

  it('进度条那一簇十一个子键，两条条共享样式、只有选源与前缀各一套', () => {
    expect(defaultKeys(field('meter')?.default)).toEqual([
      'kind',
      'source',
      'label',
      'height',
      'width',
      'color',
      'glow',
      'dot',
      'showPercent',
      'source2',
      'label2',
    ])
  })

  it('每个枚举字段的缺省都落在自己的选项里', () => {
    const stray = [...SCHEMA, ...objectFields().flatMap((f) => f.fields ?? [])]
      .filter((item) => item.type === 'enum')
      .filter(
        (item) =>
          !(item.options ?? []).some((option) => option.value === item.default),
      )
      .map((item) => item.key)

    expect(stray).toEqual([])
  })

  it('每个枚举字段都真给了选项，且取值不重复', () => {
    const broken = SCHEMA.filter((item) => item.type === 'enum')
      .map((item) => (item.options ?? []).map((option) => option.value))
      .filter(
        (values) =>
          values.length === 0 || new Set(values).size !== values.length,
      )

    expect(broken).toEqual([])
  })
})

describe('信息列表的条件显示', () => {
  it('表头只在三列表那一档露出来', () => {
    expect(field('columnHeader')).toMatchObject({
      when: { key: 'rowLayout', in: ['columns'] },
    })
  })

  it('每条条件显示都指着一个真存在的同级字段', () => {
    const dangling = SCHEMA.filter((item) => item.when !== undefined)
      .filter((item) => !TOP_KEYS.has(item.when?.key ?? ''))
      .map((item) => item.key)

    expect(dangling).toEqual([])
  })

  it('行内的条件显示指的也是行内的同级字段', () => {
    const keys = new Set(itemFields().map((item) => item.key))
    const dangling = itemFields()
      .filter((item) => item.when !== undefined)
      .filter((item) => !keys.has(item.when?.key ?? ''))
      .map((item) => item.key)

    expect(dangling).toEqual([])
  })
})

describe('信息列表的绑定槽', () => {
  it('只有一个数组槽，行钉在配置里的行上', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(slot()?.key).toBe(LIST_SLOT_KEY)
    expect(slot()?.dataType).toBe('number')
    expect(slot()?.isArray).toBe(true)
    // ⚠ 漏了它，服务端会套「索引连续且从 0 起」，「配了十行只绑第二个」直接存不下去
    expect(slot()?.isEntityPinned).toBe(true)
  })

  it('十一个子槽逐字对上：一个主读数 + 三个副读数 + 状态 + 三段文本 + 三个扩展', () => {
    expect((slot()?.arrayFields ?? []).map((item) => item.key)).toEqual([
      'value',
      'aux',
      'aux2',
      'aux3',
      'status',
      'name',
      'text',
      'time',
      'extra1',
      'extra2',
      'extra3',
    ])
  })

  it('状态子槽刻意是数值且不带 enumMap', () => {
    const status = (slot()?.arrayFields ?? []).find(
      (item) => item.key === 'status',
    )

    // ⚠ 声明了 enumMap，求值层会真的把数值换成映射值，而本仓契约把它定义成
    //   「数值 → 中文文案」：设备状态会落到 unknown，全屏徽章集体变灰且不报错
    expect(status?.enumMap).toBeUndefined()
    expect(status?.dataType).toBe('number')
  })

  it('一个子槽都不必绑，也一个都不是时序槽', () => {
    const specs = [...manifest.bindings, ...(slot()?.arrayFields ?? [])]

    // ⚠ 给了 isRequired 会让整块被判 unbound 并盖上浮层，逐行四档白画
    expect(specs.filter((item) => item.isRequired !== undefined)).toEqual([])
    expect(specs.filter((item) => item.isTimeSeries !== undefined)).toEqual([])
  })
})

describe('信息列表派生的绑点行', () => {
  it('行数跟着配置里的行走，一行都没有时给的是 0 而不是漏掉这个键', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [LIST_SLOT_KEY]: 0 })
    expect(
      manifest.bindingRowCounts?.({
        [LIST_ITEMS_KEY]: [{ label: '甲' }, { label: '乙' }],
      }),
    ).toEqual({ [LIST_SLOT_KEY]: 2 })
  })

  it('行名挂在这一行第一个子槽的 fieldKey 上，并带一份可核对的标识', () => {
    const labels = manifest.bindingRowLabels?.({
      [LIST_ITEMS_KEY]: [{ label: '出水温度', emitValue: 'out-temp' }],
    })

    expect(Object.keys(labels ?? {})).toEqual([`${LIST_SLOT_KEY}[0].value`])
    expect(labels?.[`${LIST_SLOT_KEY}[0].value`]).toEqual({
      title: expect.stringContaining('出水温度') as string,
      id: 'out-temp',
    })
  })
})

describe('信息列表的画布预览', () => {
  it('预览只提清单里有的键，且演示行数与演示读数对得上', () => {
    const config = manifest.preview?.config ?? {}
    const values = manifest.preview?.values ?? {}
    const rows = config[LIST_ITEMS_KEY]
    const readings = values[LIST_SLOT_KEY]

    expect(Object.keys(config)).toEqual([LIST_ITEMS_KEY])
    expect(Object.keys(values)).toEqual([LIST_SLOT_KEY])
    expect(Array.isArray(rows) && Array.isArray(readings)).toBe(true)
    expect((rows as unknown[]).length).toBe((readings as unknown[]).length)
  })
})
