/**
 * @fileoverview 守六套外观预设的数据面：id 集合、只写清单里有的键、枚举取值都在该字段的
 * 选项里、每套都把两个簇写全且子键顺序与字段缺省逐字相同、颜色一律 `var(--…)`、
 * 内容键一个都不写，以及逐套那几个「照抄覆盖表就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个簇，上一套留在配置里的那一整块原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 * ⚠ 覆盖表把 entity-gauge 四档写成一行并集，逐档回源码后有三处对不上，本文件把它们钉住。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/gauge-card/manifest'
import { GAUGE_SHAPES } from '../../../src/modules/gauge-card/options'
import { GAUGE_CARD_PRESETS } from '../../../src/modules/gauge-card/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))
const OBJECT_FIELDS = SCHEMA.filter((field) => field.type === 'object')

/** 预设换的是观感，这三个内容键写了就会抹掉用户配好的仪表。 */
const CONTENT_KEYS = manifest.contentKeys ?? []

/** 参考仓 entity-gauge 那四档：共用同一份留白、单位贴法与「不画目标」的口径。 */
const ENTITY_GAUGE_IDS = ['arc-gauge', 'linear-bar', 'tank', 'thermometer']

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function optionValues(field: ConfigField): unknown[] {
  return (field.options ?? []).map((option) => option.value)
}

function configOf(id: string): Record<string, unknown> {
  return GAUGE_CARD_PRESETS.find((preset) => preset.id === id)?.config ?? {}
}

/** 一层记录里落在枚举字段上、却不在该字段选项里的取值。 */
function strayEnums(
  fields: readonly ConfigField[],
  record: Record<string, unknown>,
  at: string,
): string[] {
  const found: string[] = []
  for (const [key, value] of Object.entries(record)) {
    const field = fields.find((item) => item.key === key)
    if (field === undefined) continue
    if (field.type === 'enum' && !optionValues(field).includes(value)) {
      found.push(`${at}.${key}=${String(value)}`)
    }
    found.push(...strayNested(field, value, `${at}.${key}`))
  }
  return found
}

function strayNested(field: ConfigField, value: unknown, at: string): string[] {
  if (field.fields !== undefined) {
    return strayEnums(field.fields, asRecord(value), at)
  }
  const rows = field.itemSchema
  if (rows === undefined) return []
  return asArray(value).flatMap((row, index) =>
    strayEnums(rows, asRecord(row), `${at}[${index}]`),
  )
}

/** 深走一份配置，收集每一处颜色取值。 */
function colorsIn(value: unknown, at: string): { at: string; color: string }[] {
  if (Array.isArray(value)) {
    return value.flatMap((row, index) => colorsIn(row, `${at}[${index}]`))
  }
  const record = asRecord(value)
  return Object.entries(record).flatMap(([key, child]) =>
    typeof child === 'string' && /color$/i.test(key)
      ? [{ at: `${at}.${key}`, color: child }]
      : colorsIn(child, `${at}.${key}`),
  )
}

describe('仪表卡片的六套预设', () => {
  it('id 集合恰是写死的这六个，顺序即面板上的排布', () => {
    expect(GAUGE_CARD_PRESETS.map((preset) => preset.id)).toEqual([
      'target-track',
      'arc-gauge',
      'linear-bar',
      'tank',
      'thermometer',
      'gauge-grid',
    ])
  })

  it('清单挂的就是这一份，不是另抄的一份', () => {
    expect(manifest.configPresets).toBe(GAUGE_CARD_PRESETS)
  })

  it('每套都有按钮文案与一句话说明', () => {
    const thin = GAUGE_CARD_PRESETS.filter(
      (preset) => preset.label.trim() === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(thin).toEqual([])
  })

  it('五档几何一档都不落下：六套预设摊开就是那张取值表', () => {
    const shapes = new Set(
      GAUGE_CARD_PRESETS.map((preset) => preset.config.shape),
    )

    expect([...shapes].sort()).toEqual(
      GAUGE_SHAPES.map((option) => option.value as string).sort(),
    )
  })
})

describe('预设写的键', () => {
  it('每个键都在清单的顶层键集合里', () => {
    const unknown = GAUGE_CARD_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('六套写的是同一组键——少一个键就会让上一套的那个取值原样残留', () => {
    const shapes = GAUGE_CARD_PRESETS.map((preset) =>
      Object.keys(preset.config).sort().join(','),
    )

    expect(new Set(shapes).size).toBe(1)
    expect(Object.keys(GAUGE_CARD_PRESETS[0]?.config ?? {})).toHaveLength(26)
  })

  it('观感键一个不落：顶层三十个字段里除去三个内容键，全在预设里', () => {
    const wrote = new Set(Object.keys(GAUGE_CARD_PRESETS[0]?.config ?? {}))
    const missing = [...TOP_KEYS].filter(
      (key) => !wrote.has(key) && !CONTENT_KEYS.includes(key),
    )

    expect(missing).toEqual([])
  })

  it('内容键一个都不写：预设换的是观感，不是把用户配好的仪表抹掉', () => {
    const wiped = GAUGE_CARD_PRESETS.flatMap((preset) =>
      CONTENT_KEYS.filter((key) => key in preset.config).map(
        (key) => `${preset.id}.${key}`,
      ),
    )

    expect(wiped).toEqual([])
    // 反过来锁住这三个键真的在清单里，免得改名之后这条断言变成空转
    expect(CONTENT_KEYS.filter((key) => TOP_KEYS.has(key))).toEqual(
      CONTENT_KEYS,
    )
  })
})

describe('预设写的取值', () => {
  it('每个枚举取值都在该字段的选项里，簇内也一样', () => {
    const stray = GAUGE_CARD_PRESETS.flatMap((preset) =>
      strayEnums(SCHEMA, preset.config, preset.id),
    )

    expect(stray).toEqual([])
  })

  it('扫描器认得出真写错了档位的那一处', () => {
    expect(strayEnums(SCHEMA, { shape: '弧盘' }, 'demo')).toEqual([
      'demo.shape=弧盘',
    ])
    expect(strayEnums(SCHEMA, { readoutPlace: 'middle' }, 'demo')).toEqual([
      'demo.readoutPlace=middle',
    ])
  })

  it('列数写的是字符串档值——写成数字判不中白名单，静默回落自动', () => {
    const columns = GAUGE_CARD_PRESETS.map((preset) => preset.config.columns)

    expect(columns).toEqual(['auto', 'auto', 'auto', 'auto', 'auto', '3'])
    expect(columns.every((value) => typeof value === 'string')).toBe(true)
  })

  it('每套都把每一个簇写全，子键顺序与该字段缺省逐字相同', () => {
    const drift = GAUGE_CARD_PRESETS.flatMap((preset) =>
      OBJECT_FIELDS.map((field) => ({
        at: `${preset.id}.${field.key}`,
        wrote: Object.keys(asRecord(preset.config[field.key])).join(),
        want: Object.keys(asRecord(field.default)).join(),
      })),
    ).filter((row) => row.wrote !== row.want)

    expect(OBJECT_FIELDS.length).toBeGreaterThan(0)
    expect(drift).toEqual([])
  })

  it('颜色一律 var(--…) 引用：算出来的色值换肤时不跟着走', () => {
    const literal = GAUGE_CARD_PRESETS.flatMap((preset) =>
      colorsIn(preset.config, preset.id),
    ).filter((entry) => entry.color !== '' && !entry.color.startsWith('var(--'))

    expect(literal).toEqual([])
  })

  it('扫描器真的走到了三处颜色，也走得进规则表那一层', () => {
    const found = GAUGE_CARD_PRESETS.flatMap((preset) =>
      colorsIn(preset.config, preset.id),
    ).map((entry) => entry.at)

    expect(found).toContain('arc-gauge.valueColor')
    expect(found).toContain('arc-gauge.fillColor')
    expect(found).toContain('arc-gauge.trackColor')
    expect(colorsIn({ rules: [{ color: 'tomato' }] }, 'demo')).toEqual([
      { at: 'demo.rules[0].color', color: 'tomato' },
    ])
  })

  // ⚠ 不是「写成空数组」而是**这个键根本不出现**：预设是浅合并落库的，写一个
  //   空数组等于把用户配好的阈值静默清空，而他只是想换个样子
  //   （CARD_STYLE_LIBRARY_DESIGN §1.3）
  it('六套都不碰取值规则：没有判据就不该染色，也不该把别人的判据抹掉', () => {
    expect(
      GAUGE_CARD_PRESETS.filter((preset) => 'rules' in preset.config),
    ).toEqual([])
  })

  it('千分位六套都开着——两个参考模块都走 toLocaleString 且没关分组', () => {
    expect(
      GAUGE_CARD_PRESETS.every((preset) => preset.config.thousands === true),
    ).toBe(true)
  })

  it('读数颜色六套同走强调色，填充与轨道底色一律留空跟随', () => {
    const colors = GAUGE_CARD_PRESETS.map((preset) => [
      preset.config.valueColor,
      preset.config.fillColor,
      preset.config.trackColor,
    ])

    expect(new Set(colors.map((row) => row.join()))).toEqual(
      new Set(['var(--accent-primary),,']),
    )
  })
})

describe('目标进度这一套', () => {
  it('整块留白、轨道厚度与刻度都逐字对上参考仓那一处', () => {
    const config = configOf('target-track')

    expect([config.layout, config.padX, config.padY]).toEqual(['single', 16, 6])
    expect([config.shape, config.fillStyle]).toEqual(['track', 'gradient'])
    expect(asRecord(config.geometry).thickness).toBe(18)
    expect(config.scale).toEqual({
      showRange: false,
      ticks: true,
      tickCount: 4,
      wanFormat: false,
      wanDigits: 2,
    })
    expect(config.tickSize).toBe(10)
  })

  it('只有这一套画目标标记与完成率——参考仓 entity-gauge 那四档都没有', () => {
    const marking = GAUGE_CARD_PRESETS.filter(
      (preset) =>
        preset.config.targetMark === true || preset.config.showPercent === true,
    ).map((preset) => preset.id)

    expect(marking).toEqual(['target-track'])
    expect(configOf('target-track').targetLabel).toBe('计划')
  })

  it('读数在轨道上方、自适应字号带辉光，标签在左走标题色', () => {
    const config = configOf('target-track')

    expect([config.readout, config.readoutPlace]).toEqual(['value', 'beside'])
    expect([config.valueSize, config.valueGlow]).toEqual([0, 12])
    expect([config.labelPlace, config.labelSize, config.labelTone]).toEqual([
      'left',
      15,
      'title',
    ])
  })

  it('只有这一套的单位是独立节点：十三号、与读数隔一道小间隙', () => {
    const baseline = GAUGE_CARD_PRESETS.filter(
      (preset) => preset.config.unitPlace === 'baseline',
    ).map((preset) => preset.id)

    expect(baseline).toEqual(['target-track'])
    expect(configOf('target-track').unitSize).toBe(13)
  })
})

describe('参考仓那四档几何', () => {
  it('四套共用同一份整块留白与单位贴法——参考仓把单位拼进了读数字符串', () => {
    const shared = ENTITY_GAUGE_IDS.map((id) => {
      const config = configOf(id)
      return [
        config.padX,
        config.padY,
        config.unitPlace,
        config.unitSize,
      ].join()
    })

    expect(new Set(shared)).toEqual(new Set(['6,6,attached,12']))
  })

  it('四套的厚度都交给几何档去定，罐宽管宽球径原样带着参考仓那三个数', () => {
    const geometries = ENTITY_GAUGE_IDS.map((id) =>
      asRecord(configOf(id).geometry),
    )

    for (const geometry of geometries) {
      expect(geometry).toEqual({
        thickness: 0,
        arcSpan: 270,
        tankWidth: 56,
        tubeWidth: 14,
        bulbSize: 26,
      })
    }
  })

  it('弧度盘与横向条画量程端点，储罐与温度计不画——罐身太窄摆不下', () => {
    const showing = GAUGE_CARD_PRESETS.filter(
      (preset) => asRecord(preset.config.scale).showRange === true,
    ).map((preset) => preset.id)

    expect(showing).toEqual(['arc-gauge', 'linear-bar'])
  })

  it('画端点的那两套字号是十一，与参考仓那一行量程标签同值', () => {
    expect([
      configOf('arc-gauge').tickSize,
      configOf('linear-bar').tickSize,
    ]).toEqual([11, 11])
  })

  it('弧度盘是纯色描边、居中读数、下方标签', () => {
    const config = configOf('arc-gauge')

    expect([config.shape, config.fillStyle]).toEqual(['arc', 'solid'])
    expect([config.readoutPlace, config.valueSize, config.valueGlow]).toEqual([
      'center',
      0,
      0,
    ])
    expect([config.labelPlace, config.labelSize, config.labelTone]).toEqual([
      'below',
      12,
      'secondary',
    ])
  })

  it('横向条的标签在读数右侧十一号——覆盖表写的是下方十二号，按源码取右侧', () => {
    const config = configOf('linear-bar')

    // ⚠ 参考仓 .eg-label--inline：与读数同基线、左边距 6px、11px
    expect([config.labelPlace, config.labelSize]).toEqual(['right', 11])
    expect([config.shape, config.readoutPlace]).toEqual(['linear', 'beside'])
  })

  it('储罐读数钉死十六号——罐身只有五十六像素宽，自适应字号会顶出罐外', () => {
    const config = configOf('tank')

    expect([config.shape, config.valueSize]).toEqual(['tank', 16])
    // ⚠ .eg-tank-fill 是自下而上淡出的两段渐变，不是纯色
    expect(config.fillStyle).toBe('gradient')
    expect(config.readoutPlace).toBe('center')
  })

  it('自适应字号只有储罐让了位，另外五套都留着那个哨兵零', () => {
    const pinned = GAUGE_CARD_PRESETS.filter(
      (preset) => preset.config.valueSize !== 0,
    ).map((preset) => preset.id)

    expect(pinned).toEqual(['tank'])
  })

  it('温度计是纯色管、读数列在管的右侧、标签在读数下方', () => {
    const config = configOf('thermometer')

    expect([config.shape, config.fillStyle]).toEqual(['thermometer', 'solid'])
    expect([config.readoutPlace, config.labelPlace, config.valueSize]).toEqual([
      'beside',
      'below',
      0,
    ])
  })
})

describe('仪表阵列这一套', () => {
  it('唯一走网格的一套：列数写成字符串三，间距与留白都比单个那几套宽', () => {
    const config = configOf('gauge-grid')

    expect([config.layout, config.columns]).toEqual(['grid', '3'])
    expect([config.gap, config.padX, config.padY]).toEqual([12, 8, 8])
    expect(
      GAUGE_CARD_PRESETS.filter((preset) => preset.config.layout === 'grid'),
    ).toHaveLength(1)
  })

  it('一格几十像素宽，端点与刻度都不画，只留居中读数与下方标签', () => {
    const config = configOf('gauge-grid')

    expect(config.scale).toEqual({
      showRange: false,
      ticks: false,
      tickCount: 4,
      wanFormat: false,
      wanDigits: 2,
    })
    expect([config.shape, config.readoutPlace, config.labelPlace]).toEqual([
      'arc',
      'center',
      'below',
    ])
  })
})
