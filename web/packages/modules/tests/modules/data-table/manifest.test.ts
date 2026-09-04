/**
 * @fileoverview 守数据表格清单的声明：枚举档位取自本模块那张取值表而不是手抄、
 * 「钉住表头」只在表头画得出来时出现、八个固定列子槽逐字对上且一个都不给
 * `isRequired`、行钉在配置里的行上，以及内容键与几个状态开关的取值。
 *
 * ⚠ 这几类错法 typecheck 与 lint 双双放行，表现只是「这一项永远没反应」：
 * `when` 指错键那个字段永远不出现，`isRequired` 会让整块被浮层盖住、逐格四档白画。
 */
import type { BindingSpec, ConfigField } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  CELL_SLOT_KEY,
  TABLE_COLUMNS_KEY,
  TABLE_EMPTY_TEXT,
  TABLE_ROWS_KEY,
  TABLE_RULES_KEY,
} from '../../../src/modules/data-table/cells'
import { NAME_HEADER_DEFAULT } from '../../../src/modules/data-table/look'
import manifest from '../../../src/modules/data-table/manifest'
import {
  TABLE_ALIGNS,
  TABLE_COLUMN_KEYS,
  TABLE_DENSITIES,
  TABLE_GRID_LINES,
  TABLE_MAX_ROWS_CAP,
  TABLE_PRECISION_MAX,
  TABLE_TONES,
} from '../../../src/modules/data-table/options'
import { DATA_TABLE_PRESETS } from '../../../src/modules/data-table/presets'

const SCHEMA = manifest.configSchema
const TOP_KEYS = SCHEMA.map((item) => item.key)

function field(key: string): ConfigField | undefined {
  return SCHEMA.find((item) => item.key === key)
}

function columnFields(): readonly ConfigField[] {
  return field(TABLE_COLUMNS_KEY)?.itemSchema ?? []
}

function optionValues(target: ConfigField | undefined): unknown[] {
  return (target?.options ?? []).map((option) => option.value)
}

function slot(): BindingSpec | undefined {
  return manifest.bindings.find((spec) => spec.key === CELL_SLOT_KEY)
}

describe('身份与出厂形状', () => {
  it('类型与目录名逐字相等，图标是仓里已有的那一个', () => {
    expect(manifest.type).toBe('data-table')
    expect(manifest.icon).toBe('table')
    expect(manifest.category).toBe('数据')
  })

  it('初始尺寸用本仓那四个键，不是参考仓的 w/h', () => {
    expect(manifest.defaultSize).toEqual({
      width: 480,
      height: 320,
      minWidth: 200,
      minHeight: 120,
    })
  })

  it('描述交代了两条不对称与逐格四档', () => {
    const text = manifest.description ?? ''

    expect(text.length).toBeGreaterThanOrEqual(60)
    expect(text).toContain('列键')
    expect(text).toContain('下标')
    expect(text).toContain('四档')
  })

  it('内容键含标题、表头文案、列、行、空态与规则六个', () => {
    expect(manifest.contentKeys).toEqual([
      'title',
      'nameHeader',
      TABLE_COLUMNS_KEY,
      TABLE_ROWS_KEY,
      'emptyText',
      TABLE_RULES_KEY,
    ])
    expect(manifest.contentKeys?.every((key) => TOP_KEYS.includes(key))).toBe(
      true,
    )
  })

  it('预设整套挂在清单上，画布演示只提清单里有的键', () => {
    expect(manifest.configPresets).toBe(DATA_TABLE_PRESETS)
    expect(Object.keys(manifest.preview?.config ?? {})).toEqual([
      TABLE_ROWS_KEY,
      TABLE_COLUMNS_KEY,
    ])
    expect(Object.keys(manifest.preview?.values ?? {})).toEqual([CELL_SLOT_KEY])
  })
})

describe('配置字段', () => {
  it('三个枚举的档位取自本模块那几张取值表', () => {
    expect(optionValues(field('density'))).toEqual(
      TABLE_DENSITIES.map((item) => item.value),
    )
    expect(optionValues(field('gridLines'))).toEqual(
      TABLE_GRID_LINES.map((item) => item.value),
    )
    expect(optionValues(field('nameTone'))).toEqual(
      TABLE_TONES.map((item) => item.value),
    )
  })

  // ⚠ 表头关着时钉不钉都没有意义，摆出来只会让人以为配了没反应
  it('「钉住表头」只在表头画得出来时出现', () => {
    expect(field('headerSticky')?.when).toEqual({
      key: 'showHeader',
      in: [true],
    })
  })

  it('空态文案的出厂值就是取值层那句兜底', () => {
    expect(field('emptyText')?.default).toBe(TABLE_EMPTY_TEXT)
  })

  it('行名列表头的出厂值与形态层共用一份常量', () => {
    expect(field('nameHeader')?.default).toBe(NAME_HEADER_DEFAULT)
  })

  it('行数上限出厂 0（不限），上界与取值层共用一份常量', () => {
    expect(field('maxRows')?.default).toBe(0)
    expect(field('maxRows')?.max).toBe(TABLE_MAX_ROWS_CAP)
  })

  it('行与列都出厂给一项：空列表时模块是一块看着像坏了的白板', () => {
    expect(field(TABLE_ROWS_KEY)?.default).toEqual([{ name: '第 1 行' }])
    expect(field(TABLE_COLUMNS_KEY)?.default).toEqual([
      { key: 'c1', name: '数值', align: 'right' },
    ])
    expect(field(TABLE_ROWS_KEY)?.itemLabelKey).toBe('name')
    expect(field(TABLE_COLUMNS_KEY)?.itemLabelKey).toBe('name')
  })

  it('列内六个子字段就是列键、列名、单位、小数位、对齐与列宽', () => {
    expect(columnFields().map((item) => item.key)).toEqual([
      'key',
      'name',
      'unit',
      'precision',
      'align',
      'width',
    ])
  })

  it('列键与对齐的档位取自取值表，列键出厂 c1', () => {
    const key = columnFields().find((item) => item.key === 'key')

    expect(optionValues(key)).toEqual(TABLE_COLUMN_KEYS.map((c) => c.value))
    expect(key?.default).toBe('c1')
    expect(
      optionValues(columnFields().find((item) => item.key === 'align')),
    ).toEqual(TABLE_ALIGNS.map((item) => item.value))
  })

  // ⚠ 滑杆没有空态：没配时面板显示 0 而渲染按整块那一档走，两边对不上，
  //   而且拖过一次就再也回不到「跟随整块」
  it('列内小数位是数字框且刻意没有缺省：留空 = 跟随整块', () => {
    const precision = columnFields().find((item) => item.key === 'precision')

    expect(precision?.type).toBe('number')
    expect(precision).not.toHaveProperty('default')
    expect(precision?.max).toBe(TABLE_PRECISION_MAX)
  })

  it('整块小数位有缺省，与列内那一档区分得开', () => {
    expect(field('precision')?.default).toBe(2)
    expect(field('precision')?.max).toBe(TABLE_PRECISION_MAX)
  })

  it('值规则摆在规则分段里，键与共用那一份一致', () => {
    expect(field(TABLE_RULES_KEY)?.group).toBe('规则')
    expect(field(TABLE_RULES_KEY)?.type).toBe('array')
  })
})

describe('绑定槽', () => {
  it('唯一的数组槽行钉在配置里的行上', () => {
    expect(slot()?.isArray).toBe(true)
    expect(slot()?.isEntityPinned).toBe(true)
    expect(manifest.bindings).toHaveLength(1)
  })

  it('八个固定列子槽逐字对上取值表', () => {
    expect((slot()?.arrayFields ?? []).map((item) => item.key)).toEqual(
      TABLE_COLUMN_KEYS.map((column) => column.value),
    )
  })

  // ⚠ 配了 8 列先接 2 列是常态；给了会让整块被判 unbound 并盖上浮层，逐格四档白画
  it('一个子槽都不给 isRequired', () => {
    const required = (slot()?.arrayFields ?? []).filter(
      (item) => item.isRequired === true,
    )

    expect(required).toEqual([])
  })

  it('表格没有历史序列，不声明时序槽', () => {
    expect(slot()?.isTimeSeries).toBeUndefined()
  })

  it('行数与行标题都跟着配置里的行走', () => {
    const config = { [TABLE_ROWS_KEY]: [{ name: '甲' }, { name: '乙' }] }

    expect(manifest.bindingRowCounts?.(config)).toEqual({ [CELL_SLOT_KEY]: 2 })
    expect(
      Object.values(manifest.bindingRowLabels?.(config) ?? {}).map(
        (label) => label.title,
      ),
    ).toEqual(['甲', '乙'])
  })

  it('一行都没配时行数也给 0，不许把键漏掉', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [CELL_SLOT_KEY]: 0 })
  })
})

describe('状态与交互', () => {
  it('四档由模块自己逐格交代，整块可点与行点击同时开', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
  })
})
