/**
 * @fileoverview 守五套外观预设的数据面：id 集合、只写清单里有的键、枚举取值都在该字段的
 * 选项里、每套都把每一个簇写全且子键顺序与字段缺省逐字相同、颜色一律 `var(--…)`、
 * 内容键一个都不写，以及逐套那几个「照抄覆盖表就会错」的取值。
 *
 * ⚠ 这几类错法点了按钮什么都不会发生，而 typecheck、lint、build 全绿：
 * 键写错就是「配了不生效」；少写一个簇，上一套留在配置里的那一整块原样残留，
 * 而点亮判定做的是子集比较、照样把按钮点亮。
 */
import type { ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { CARD_ITEMS_KEY } from '../../../src/modules/info-card/cells'
import manifest from '../../../src/modules/info-card/manifest'
import { INFO_CARD_PRESETS } from '../../../src/modules/info-card/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = new Set(SCHEMA.map((field) => field.key))
const OBJECT_FIELDS = SCHEMA.filter((field) => field.type === 'object')

/** 预设换的是观感，这三个内容键写了就会抹掉用户配好的格。 */
const CONTENT_KEYS = ['title', CARD_ITEMS_KEY, 'emptyText']

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
  return INFO_CARD_PRESETS.find((preset) => preset.id === id)?.config ?? {}
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

describe('信息卡片的五套预设', () => {
  it('id 集合恰是写死的这五个，顺序即面板上的排布', () => {
    expect(INFO_CARD_PRESETS.map((preset) => preset.id)).toEqual([
      'kpi-single',
      'kpi-grid',
      'icon-grid',
      'icon-column',
      'plain-grid',
    ])
  })

  it('清单挂的就是这一份，不是另抄的一份', () => {
    expect(manifest.configPresets).toBe(INFO_CARD_PRESETS)
  })

  it('每套都有按钮文案与一句话说明', () => {
    const thin = INFO_CARD_PRESETS.filter(
      (preset) => preset.label.trim() === '' || (preset.hint ?? '') === '',
    ).map((preset) => preset.id)

    expect(thin).toEqual([])
  })
})

describe('预设写的键', () => {
  it('每个键都在清单的顶层键集合里', () => {
    const unknown = INFO_CARD_PRESETS.flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !TOP_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('五套写的是同一组键——少一个键就会让上一套的那个取值原样残留', () => {
    const shapes = INFO_CARD_PRESETS.map((preset) =>
      Object.keys(preset.config).sort().join(','),
    )

    expect(new Set(shapes).size).toBe(1)
    expect(Object.keys(INFO_CARD_PRESETS[0]?.config ?? {})).toHaveLength(30)
  })

  it('观感键一个不落：顶层三十三个字段里除去三个内容键，全在预设里', () => {
    const wrote = new Set(Object.keys(INFO_CARD_PRESETS[0]?.config ?? {}))
    const missing = [...TOP_KEYS].filter(
      (key) => !wrote.has(key) && !CONTENT_KEYS.includes(key),
    )

    expect(missing).toEqual([])
  })

  it('内容键一个都不写：预设换的是观感，不是把用户配好的格抹掉', () => {
    const wiped = INFO_CARD_PRESETS.flatMap((preset) =>
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
    const stray = INFO_CARD_PRESETS.flatMap((preset) =>
      strayEnums(SCHEMA, preset.config, preset.id),
    )

    expect(stray).toEqual([])
  })

  it('扫描器认得出真写错了档位的那一处', () => {
    expect(strayEnums(SCHEMA, { cellShell: '描边卡' }, 'demo')).toEqual([
      'demo.cellShell=描边卡',
    ])
    expect(strayEnums(SCHEMA, { icon: { mode: 'badges' } }, 'demo')).toEqual([
      'demo.icon.mode=badges',
    ])
  })

  it('列数写的是字符串档值——写成数字判不中白名单，静默回落自动', () => {
    const columns = INFO_CARD_PRESETS.map((preset) => preset.config.columns)

    expect(columns).toEqual(['auto', 'auto', '2', '2', 'auto'])
    expect(columns.every((value) => typeof value === 'string')).toBe(true)
  })

  it('每套都把每一个簇写全，子键顺序与该字段缺省逐字相同', () => {
    const drift = INFO_CARD_PRESETS.flatMap((preset) =>
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
    const literal = INFO_CARD_PRESETS.flatMap((preset) =>
      colorsIn(preset.config, preset.id),
    ).filter((entry) => entry.color !== '' && !entry.color.startsWith('var(--'))

    expect(literal).toEqual([])
  })

  it('扫描器真的走到了簇里那一层颜色，不是只扫了顶层', () => {
    const found = INFO_CARD_PRESETS.flatMap((preset) =>
      colorsIn(preset.config, preset.id),
    ).map((entry) => entry.at)

    expect(found).toContain('kpi-single.valueColor')
    expect(found).toContain('icon-grid.icon.borderColor')
  })

  it('五套都不带取值规则也不画状态点：没有判据就连正常都不该说', () => {
    expect(INFO_CARD_PRESETS.map((preset) => preset.config.rules)).toEqual([
      [],
      [],
      [],
      [],
      [],
    ])
    expect(
      INFO_CARD_PRESETS.every((preset) => preset.config.statusDot === 'none'),
    ).toBe(true)
  })

  it('千分位五套都关着——三个参考模块的缺省都是关的', () => {
    expect(
      INFO_CARD_PRESETS.every((preset) => preset.config.thousands === false),
    ).toBe(true)
  })
})

describe('单值大字这一套', () => {
  it('整块留白就是参考仓那一处 padding，格自己不再留白，否则左右翻倍', () => {
    const config = configOf('kpi-single')

    expect([config.layout, config.padX, config.padY]).toEqual(['single', 12, 4])
    expect([config.cellShell, config.cellPadX, config.cellPadY]).toEqual([
      'plain',
      0,
      0,
    ])
  })

  it('居中大字、标签在下、单位十三号，辉光十二', () => {
    const config = configOf('kpi-single')

    expect([config.align, config.labelPlace, config.labelSize]).toEqual([
      'center',
      'below',
      12,
    ])
    expect([config.valueSize, config.valueGlow]).toEqual([0, 12])
    expect(config.unit).toEqual({
      place: 'baseline',
      size: 13,
      tone: 'secondary',
      opacity: 1,
    })
  })

  it('右上角标二十像素、压到八五成不透明，涨跌块只有这一套开着', () => {
    expect(configOf('kpi-single').icon).toMatchObject({
      mode: 'corner',
      size: 20,
      opacity: 0.85,
    })
    expect(
      INFO_CARD_PRESETS.filter(
        (preset) => asRecord(preset.config.compare).show === true,
      ).map((preset) => preset.id),
    ).toEqual(['kpi-single'])
    expect(configOf('kpi-single').compare).toEqual({
      show: true,
      mode: 'percent',
      label: '',
      invertTrend: false,
    })
  })
})

describe('指标小卡这一套', () => {
  it('描边渐变小卡加左侧发光竖条，格内留白与格间距逐字对上参考观感', () => {
    const config = configOf('kpi-grid')

    expect([config.layout, config.columns, config.cellShell]).toEqual([
      'grid',
      'auto',
      'accent',
    ])
    expect([config.gapX, config.gapY, config.padX, config.padY]).toEqual([
      10, 10, 10, 6,
    ])
    expect([config.cellPadX, config.cellPadY]).toEqual([12, 8])
  })

  it('悬停会上浮：参考仓那一处 hover 带位移，所以不是提亮档', () => {
    const hovers = INFO_CARD_PRESETS.map((preset) => [
      preset.id,
      preset.config.hover,
    ])

    expect(hovers).toEqual([
      ['kpi-single', 'none'],
      ['kpi-grid', 'lift'],
      ['icon-grid', 'none'],
      ['icon-column', 'none'],
      ['plain-grid', 'none'],
    ])
  })

  it('自适应字号配十号辉光，标签在上', () => {
    const config = configOf('kpi-grid')

    expect([config.valueSize, config.valueGlow, config.labelPlace]).toEqual([
      0,
      10,
      'above',
    ])
  })
})

describe('图标网格与图标竖排两套', () => {
  it('格子彼此相接：整块与格间距全是零，留白只在格内', () => {
    const config = configOf('icon-grid')

    expect([config.gapX, config.gapY, config.padX, config.padY]).toEqual([
      0, 0, 0, 0,
    ])
    expect([config.cellShell, config.cellPadX, config.cellPadY]).toEqual([
      'plain',
      10,
      5,
    ])
  })

  it('标签走标题色压到六成，读数钉死二十六号且不带辉光', () => {
    const config = configOf('icon-grid')

    expect([config.labelSize, config.labelTone, config.labelOpacity]).toEqual([
      13,
      'title',
      0.6,
    ])
    expect([config.valueSize, config.valueGlow, config.valueFont]).toEqual([
      26,
      0,
      'digit',
    ])
  })

  it('圆形图标容器十二个子键写全，参考仓那三个不存在的 token 一律留空', () => {
    expect(configOf('icon-grid').icon).toEqual({
      mode: 'badge',
      position: 'left',
      size: 40,
      shape: 'circle',
      bgFrom: '',
      bgTo: '',
      bgAngle: 135,
      borderColor: '',
      glow: 8,
      gap: 10,
      fontSize: 18,
      opacity: 1,
    })
  })

  it('单位取最接近参考仓那档标题色的正文档，并压到五成', () => {
    expect(configOf('icon-grid').unit).toEqual({
      place: 'baseline',
      size: 12,
      tone: 'primary',
      opacity: 0.5,
    })
  })

  it('竖排与网格只差图标方位与对齐两处——只换方位会得到图标在上而文字仍左对齐', () => {
    const grid = configOf('icon-grid')
    const column = configOf('icon-column')
    const differing = Object.keys(grid).filter(
      (key) => JSON.stringify(grid[key]) !== JSON.stringify(column[key]),
    )

    expect(differing.sort()).toEqual(['align', 'icon'])
    expect([column.align, asRecord(column.icon).position]).toEqual([
      'center',
      'top',
    ])
  })
})

describe('裸排网格这一套', () => {
  it('无边框无底也不画图标，密排靠格间距与格内留白', () => {
    const config = configOf('plain-grid')

    expect([config.cellShell, config.hover]).toEqual(['plain', 'none'])
    expect(asRecord(config.icon).mode).toBe('none')
    expect([
      config.gapX,
      config.gapY,
      config.cellPadX,
      config.cellPadY,
    ]).toEqual([8, 8, 8, 6])
  })

  it('不画图标的两套把图标簇留在缺省档，不是把这个簇整块漏掉', () => {
    const plain = asRecord(configOf('plain-grid').icon)

    expect(plain).toEqual(asRecord(configOf('kpi-grid').icon))
    expect(Object.keys(plain)).toEqual(
      Object.keys(asRecord(SCHEMA.find((f) => f.key === 'icon')?.default)),
    )
  })
})
