/**
 * @fileoverview 守信息流清单的声明：字段预算（顶层 18 / 行内 0）、绑定槽**刻意不是**
 * 钉实体档、三个文本子槽逐字对上、条目状态由模块自己交代。
 *
 * ⚠ 最要紧的一条是「不是钉实体档」：`isEntityPinned` 与 `bindingRowCounts` 是同一档
 * 口径的两半，任何一半冒出来，条目就从「用户在绑点面板上增删」变成「行数由配置决定」，
 * 而本模块根本没有 config 侧的条目——界面上看不出任何异常，整块从此一条也摆不出来。
 * 这几类错法 typecheck 与 lint 双双放行。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { FEED_SLOT_KEY } from '../../../src/modules/info-feed/feed'
import manifest from '../../../src/modules/info-feed/manifest'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function levelFields(): readonly ConfigField[] {
  return field('levels')?.itemSchema ?? []
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function subSlots(): readonly BindingSpec[] {
  return slot()?.arrayFields ?? []
}

describe('信息流清单的身份', () => {
  it('是数据类的展示模块，吃平台那套统一卡片外观', () => {
    expect(manifest.type).toBe('info-feed')
    expect(manifest.displayName).toBe('信息流')
    expect(manifest.category).toBe('数据')
    expect(manifest.icon).toBe('activity')
    // 缺省就是 card：自绘标题条的模块才需要声明，声明了反而画出两层框
    expect(manifest.chrome).toBeUndefined()
    expect(manifest.chromeConfigurable).toBeUndefined()
    // 标题栏交给 ModulePanel，四十个外观键一个都不挑
    expect(manifest.unsupportedChromeKeys).toBeUndefined()
  })

  it('默认尺寸摆得下几条信息，最小尺寸仍留得住一条', () => {
    expect(manifest.defaultSize).toEqual({
      width: 400,
      height: 260,
      minWidth: 160,
      minHeight: 96,
    })
  })

  it('自己交代条目的取数状态，并按条目上抛联动值', () => {
    // ⚠ 不开的话，一条推送坏掉会让整块被浮层盖住，另外几条一个都看不见
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
    // 缺省就是 ['click']，声明一遍只会多一处要同步的地方
    expect(manifest.interactionEvents).toBeUndefined()
  })
})

describe('信息流的绑定槽是列表式的', () => {
  it('刻意不是钉实体档：两个标记一个都不给', () => {
    // ⚠ 这两条是本模块从参考仓分家出来的全部理由。任何一条冒出来，条目就改由
    //   配置决定行数，而本模块没有配置侧的条目——面板收起增删键，整块从此空着
    expect(slot()?.isEntityPinned).toBeUndefined()
    expect(manifest.bindingRowCounts).toBeUndefined()
    // 条目不是配置里的实体，第三条叫什么只有推来的数据知道，编辑期无从自述
    expect(manifest.bindingRowLabels).toBeUndefined()
  })

  it('只有一个数组槽，三个子槽逐字对上', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(slot()?.key).toBe(FEED_SLOT_KEY)
    expect(slot()?.label).toBe('信息流条目')
    expect(slot()?.dataType).toBe('string')
    expect(slot()?.isArray).toBe(true)
    expect(subSlots().map((item) => item.key)).toEqual([
      'level',
      'text',
      'time',
    ])
  })

  it('三个子槽都收文本：级别与时间都原样直通，不在这里换算', () => {
    expect(subSlots().map((item) => item.dataType)).toEqual([
      'string',
      'string',
      'string',
    ])
    // ⚠ 声明 enumMap 会让求值层把值换成映射后的文案，级别再也比不中色板的 key
    expect(subSlots().filter((item) => item.enumMap !== undefined)).toEqual([])
  })

  it('一个子槽都不必绑，也一个都不是时序槽', () => {
    const specs = [...manifest.bindings, ...subSlots()]

    // ⚠ 给了 isRequired 会让整块被判 unbound 并盖上浮层，条目级的四档白画
    expect(specs.filter((item) => item.isRequired !== undefined)).toEqual([])
    expect(specs.filter((item) => item.isTimeSeries !== undefined)).toEqual([])
  })
})

describe('信息流的字段预算', () => {
  it('顶层十八个字段，键唯一且就是这一串', () => {
    expect(SCHEMA.map((item) => item.key)).toEqual([
      'title',
      'emptyText',
      'showDot',
      'dotSize',
      'dotGlow',
      'showLevel',
      'levelSize',
      'textSize',
      'showTime',
      'timeSize',
      'timePlace',
      'rowBorderStyle',
      'rowPadX',
      'rowPadY',
      'levels',
      'sortByRank',
      'autoScroll',
      'scrollSpeed',
    ])
    expect(TOP_KEYS.size).toBe(18)
  })

  it('没有配置侧的条目数组——条目全部来自绑定，级别色板是唯一一个数组字段', () => {
    const arrays = SCHEMA.filter((item) => item.type === 'array')

    expect(arrays.map((item) => item.key)).toEqual(['levels'])
    expect(TOP_KEYS.has('items')).toBe(false)
  })

  it('一个簇都没有：十八个字段全是平铺的，没有整块覆盖那回事', () => {
    // 有簇就必须有整块 default，且键序即预设的基准；这里没有簇，故那条基准不适用
    expect(SCHEMA.filter((item) => item.type === 'object')).toEqual([])
    expect(SCHEMA.filter((item) => item.fields !== undefined)).toEqual([])
  })

  it('级别色板每条四个子键，键唯一', () => {
    const keys = levelFields().map((item) => item.key)

    expect(keys).toEqual(['key', 'label', 'color', 'rank'])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('没有第三层容器字段——真降级时面板只是悄悄换成一个 JSON 文本框', () => {
    const depths = containerDepths(SCHEMA)

    expect(depths.length).toBeGreaterThan(0)
    expect(depths.filter((depth) => depth >= 3)).toEqual([])
  })
})

describe('信息流的缺省', () => {
  it('每个顶层字段都有缺省，摊得出一份完整配置', () => {
    const missing = SCHEMA.filter((item) => item.default === undefined).map(
      (item) => item.key,
    )

    expect(missing).toEqual([])
  })

  it('级别色板的四个子键也都有缺省，且颜色缺省是空串', () => {
    const missing = levelFields()
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
    // ⚠ 空串 = 这一条不覆盖颜色，仍回落内置档；填个色值就再也回不去了
    expect(levelFields().find((item) => item.key === 'color')?.default).toBe('')
  })

  it('尺寸类字段的缺省与区间逐字对上参考观感', () => {
    const bounds = ['dotSize', 'dotGlow', 'levelSize', 'textSize', 'timeSize']
      .map(field)
      .map((item) => [item?.key, item?.default, item?.min, item?.max])

    expect(bounds).toEqual([
      ['dotSize', 8, 4, 24],
      ['dotGlow', 6, 0, 24],
      ['levelSize', 12, 10, 32],
      ['textSize', 13, 10, 32],
      ['timeSize', 12, 10, 32],
    ])
  })

  it('行内边距的缺省与区间逐字对上参考观感', () => {
    const pads = ['rowPadX', 'rowPadY']
      .map(field)
      .map((item) => [item?.key, item?.default, item?.min, item?.max])

    expect(pads).toEqual([
      ['rowPadX', 4, 0, 24],
      ['rowPadY', 7, 0, 24],
    ])
  })

  it('三个开关缺省全开，空态文案与分隔线各有一句缺省', () => {
    expect([
      field('showDot')?.default,
      field('showLevel')?.default,
      field('showTime')?.default,
      // ⚠ 直通语义：缺省不重排，最新的一条留在最上面
      field('sortByRank')?.default,
    ]).toEqual([true, true, true, false])
    expect(field('emptyText')?.default).toBe('暂无信息')
    expect(field('rowBorderStyle')?.default).toBe('dotted')
    expect(field('levels')?.default).toEqual([])
  })

  it('每个枚举字段的缺省都落在自己的选项里', () => {
    const stray = SCHEMA.filter((item) => item.type === 'enum').filter(
      (item) =>
        !(item.options ?? []).some((option) => option.value === item.default),
    )

    const enums = SCHEMA.filter((item) => item.type === 'enum')

    expect(stray.map((item) => item.key)).toEqual([])
    // 反过来锁住这条断言不是空转：本模块真有枚举字段
    expect(enums.map((item) => item.key)).toEqual([
      'timePlace',
      'rowBorderStyle',
    ])
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

describe('信息流的条件显示', () => {
  it('尺寸与位置只在对应的开关开着时露出来', () => {
    const gated = SCHEMA.filter((item) => item.when !== undefined).map(
      (item) => [item.key, item.when?.key],
    )

    expect(gated).toEqual([
      ['dotSize', 'showDot'],
      ['dotGlow', 'showDot'],
      ['levelSize', 'showLevel'],
      ['timeSize', 'showTime'],
      ['timePlace', 'showTime'],
      ['scrollSpeed', 'autoScroll'],
    ])
  })

  it('每条条件显示都指着一个真存在的同级字段', () => {
    const dangling = SCHEMA.filter((item) => item.when !== undefined)
      .filter((item) => !TOP_KEYS.has(item.when?.key ?? ''))
      .map((item) => item.key)

    expect(dangling).toEqual([])
  })

  it('级别色板行内没有条件显示——那一层的条件判不到顶层', () => {
    expect(levelFields().filter((item) => item.when !== undefined)).toEqual([])
  })
})

describe('信息流的画布预览', () => {
  it('只提演示条目，不提演示配置', () => {
    const values = manifest.preview?.values ?? {}

    // ⚠ 本模块的内容全部来自绑定：拿 preview 去改标题或观感，画布上与运行态
    //   会长成两个样子，而两边都不报错
    expect(manifest.preview?.config).toBeUndefined()
    expect(Object.keys(values)).toEqual([FEED_SLOT_KEY])
  })

  it('演示条目三条，每条都写全三个子槽', () => {
    const shapes = asArray(manifest.preview?.values?.[FEED_SLOT_KEY]).map(
      (row) => Object.keys(asRecord(row)).join(),
    )

    expect(shapes).toEqual([
      'level,text,time',
      'level,text,time',
      'level,text,time',
    ])
  })
})
