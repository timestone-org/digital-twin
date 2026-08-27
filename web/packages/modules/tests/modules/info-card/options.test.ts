/**
 * @fileoverview 守 info-card 取值表的四条契约：每张表自身自洽（档值唯一、白名单与表同序）、
 * 三张映射表逐档齐全、几处「档数以参考源码为准」的收敛被钉死，以及严重度词表不与面板下拉串味。
 * ⚠ 这几条错了一条都不报错：面板照样能选，渲染静默回落默认档，墙上只是少一块颜色。
 */
import { describe, expect, it } from 'vitest'

import {
  CARD_ALIGN_VALUES,
  CARD_ALIGNS,
  CARD_CELL_SHELL_VALUES,
  CARD_CELL_SHELLS,
  CARD_COLUMN_VALUES,
  CARD_COLUMNS,
  CARD_COMPARE_MODE_VALUES,
  CARD_COMPARE_MODES,
  CARD_HOVER_VALUES,
  CARD_HOVERS,
  CARD_ICON_MODE_VALUES,
  CARD_ICON_MODES,
  CARD_ICON_POSITION_VALUES,
  CARD_ICON_POSITIONS,
  CARD_ICON_RADII,
  CARD_ICON_SHAPE_VALUES,
  CARD_ICON_SHAPES,
  CARD_LABEL_PLACE_VALUES,
  CARD_LABEL_PLACES,
  CARD_LABEL_TONE_COLORS,
  CARD_LABEL_TONE_VALUES,
  CARD_LABEL_TONES,
  CARD_LAYOUT_VALUES,
  CARD_LAYOUTS,
  CARD_STATUS_DOT_VALUES,
  CARD_STATUS_DOTS,
  CARD_UNIT_PLACE_VALUES,
  CARD_UNIT_PLACES,
  CARD_UNIT_TONE_COLORS,
  CARD_UNIT_TONE_VALUES,
  CARD_UNIT_TONES,
  CARD_VALUE_FILL_VALUES,
  CARD_VALUE_FILLS,
  CARD_VALUE_FONT_VALUES,
  CARD_VALUE_FONTS,
  CARD_VALUE_KIND_VALUES,
  CARD_VALUE_KINDS,
  LEVEL_TEXT,
} from '../../../src/modules/info-card/options'
import { LEVEL_OPTIONS, SEVERITY_RANK } from '../../../src/shared/thresholds'

/** 一张待检的取值表：名字只为让失败信息说得出是哪一张。 */
interface OptionTable {
  name: string
  options: readonly { readonly value: string; readonly label: string }[]
  values: readonly string[]
}

const TABLES: readonly OptionTable[] = [
  { name: '排布', options: CARD_LAYOUTS, values: CARD_LAYOUT_VALUES },
  { name: '列数', options: CARD_COLUMNS, values: CARD_COLUMN_VALUES },
  { name: '格外壳', options: CARD_CELL_SHELLS, values: CARD_CELL_SHELL_VALUES },
  { name: '悬停', options: CARD_HOVERS, values: CARD_HOVER_VALUES },
  { name: '对齐', options: CARD_ALIGNS, values: CARD_ALIGN_VALUES },
  {
    name: '标签位置',
    options: CARD_LABEL_PLACES,
    values: CARD_LABEL_PLACE_VALUES,
  },
  {
    name: '标签层级',
    options: CARD_LABEL_TONES,
    values: CARD_LABEL_TONE_VALUES,
  },
  {
    name: '数值填充',
    options: CARD_VALUE_FILLS,
    values: CARD_VALUE_FILL_VALUES,
  },
  {
    name: '数值字体',
    options: CARD_VALUE_FONTS,
    values: CARD_VALUE_FONT_VALUES,
  },
  {
    name: '单位位置',
    options: CARD_UNIT_PLACES,
    values: CARD_UNIT_PLACE_VALUES,
  },
  { name: '单位层级', options: CARD_UNIT_TONES, values: CARD_UNIT_TONE_VALUES },
  { name: '图标画法', options: CARD_ICON_MODES, values: CARD_ICON_MODE_VALUES },
  {
    name: '图标方位',
    options: CARD_ICON_POSITIONS,
    values: CARD_ICON_POSITION_VALUES,
  },
  {
    name: '图标形状',
    options: CARD_ICON_SHAPES,
    values: CARD_ICON_SHAPE_VALUES,
  },
  {
    name: '对比显示',
    options: CARD_COMPARE_MODES,
    values: CARD_COMPARE_MODE_VALUES,
  },
  { name: '状态点', options: CARD_STATUS_DOTS, values: CARD_STATUS_DOT_VALUES },
  { name: '值类型', options: CARD_VALUE_KINDS, values: CARD_VALUE_KIND_VALUES },
]

describe('取值表自身自洽', () => {
  it('一张表都没漏登记，表名也不重复', () => {
    expect(TABLES).toHaveLength(17)
    expect(new Set(TABLES.map((table) => table.name)).size).toBe(TABLES.length)
  })

  it('每张表的档值互不重复，也没有空档', () => {
    for (const table of TABLES) {
      const unique = new Set(table.options.map((option) => option.value))

      expect([table.name, unique.size]).toEqual([
        table.name,
        table.options.length,
      ])
      expect([table.name, table.options.every((o) => o.value !== '')]).toEqual([
        table.name,
        true,
      ])
    }
  })

  it('每一档都配了中文标签，不是把档值抄一遍', () => {
    for (const table of TABLES) {
      const named = table.options.every(
        (option) => option.label !== '' && option.label !== option.value,
      )

      expect([table.name, named]).toEqual([table.name, true])
    }
  })

  it('白名单与选项表逐项同序——两边手抄迟早漂，档位就静默回落了', () => {
    for (const table of TABLES) {
      expect([table.name, [...table.values]]).toEqual([
        table.name,
        table.options.map((option) => option.value),
      ])
    }
  })
})

describe('映射表逐档齐全', () => {
  it('标签四档各有一个主题变量', () => {
    expect(Object.keys(CARD_LABEL_TONE_COLORS).sort()).toEqual(
      [...CARD_LABEL_TONE_VALUES].sort(),
    )
    expect(
      Object.values(CARD_LABEL_TONE_COLORS).every((color) =>
        color.startsWith('var(--'),
      ),
    ).toBe(true)
  })

  it('单位四档里只有「跟随数值色」是空串哨兵，其余都是主题变量', () => {
    expect(Object.keys(CARD_UNIT_TONE_COLORS).sort()).toEqual(
      [...CARD_UNIT_TONE_VALUES].sort(),
    )
    expect(CARD_UNIT_TONE_COLORS.accent).toBe('')
    expect(
      Object.entries(CARD_UNIT_TONE_COLORS)
        .filter(([tone]) => tone !== 'accent')
        .every(([, color]) => color.startsWith('var(--')),
    ).toBe(true)
  })

  it('图标三种形状各有一个圆角值，圆角方走卡片圆角 token', () => {
    expect(CARD_ICON_RADII).toEqual({
      circle: '50%',
      rounded: 'var(--radius-md)',
      square: '0',
    })
  })
})

describe('档数以参考源码为准', () => {
  it('排布三档：自动、单格大字、网格', () => {
    expect([...CARD_LAYOUT_VALUES]).toEqual(['auto', 'single', 'grid'])
  })

  it('列数从一列起，档值一律是字符串——写成数字判不中，静默回落自动', () => {
    expect([...CARD_COLUMN_VALUES]).toEqual([
      'auto',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
    expect(
      CARD_COLUMNS.every((option) => typeof option.value === 'string'),
    ).toBe(true)
  })

  it('格外壳三档：裸排、卡片、卡片加左色条', () => {
    expect([...CARD_CELL_SHELL_VALUES]).toEqual(['plain', 'card', 'accent'])
  })

  it('悬停三档，提亮与上浮各自一档', () => {
    expect([...CARD_HOVER_VALUES]).toEqual(['none', 'tint', 'lift'])
  })

  it('对齐三档，右对齐不是多出来的一档', () => {
    expect([...CARD_ALIGN_VALUES]).toEqual(['left', 'center', 'right'])
  })

  it('标签位置三档，没有「隐藏」：留空标签文字即整行不渲染', () => {
    expect([...CARD_LABEL_PLACE_VALUES]).toEqual(['above', 'below', 'left'])
    expect(CARD_LABEL_PLACE_VALUES).not.toContain('hidden')
  })

  it('单位两档，没有第三种贴法，也没有独占一列', () => {
    expect([...CARD_UNIT_PLACE_VALUES]).toEqual(['baseline', 'attached'])
    expect(CARD_UNIT_PLACE_VALUES).not.toContain('column')
  })

  it('图标三档：不画、右上角标、图标容器', () => {
    expect([...CARD_ICON_MODE_VALUES]).toEqual(['none', 'corner', 'badge'])
    expect([...CARD_ICON_POSITION_VALUES]).toEqual(['left', 'top'])
    expect([...CARD_ICON_SHAPE_VALUES]).toEqual(['circle', 'rounded', 'square'])
  })

  it('数值两档填充、两档字体', () => {
    expect([...CARD_VALUE_FILL_VALUES]).toEqual(['solid', 'gradient'])
    expect([...CARD_VALUE_FONT_VALUES]).toEqual(['digit', 'body'])
  })

  it('对比三档、状态点两档', () => {
    expect([...CARD_COMPARE_MODE_VALUES]).toEqual(['percent', 'delta', 'both'])
    expect([...CARD_STATUS_DOT_VALUES]).toEqual(['none', 'auto'])
  })

  it('值类型三档，开关量与本仓 metric-card 是同一个词', () => {
    expect([...CARD_VALUE_KIND_VALUES]).toEqual(['number', 'boolean', 'text'])
  })
})

describe('严重度词表', () => {
  it('四个严重度一个不少，与排序表同一套键', () => {
    expect(Object.keys(LEVEL_TEXT).sort()).toEqual(
      Object.keys(SEVERITY_RANK).sort(),
    )
    expect(new Set(Object.values(LEVEL_TEXT)).size).toBe(4)
  })

  it('词不带括注：下拉那份是给人挑的，状态点这份是给人读的', () => {
    const panelDanger = LEVEL_OPTIONS.find(
      (option) => option.value === 'danger',
    )

    expect(
      Object.values(LEVEL_TEXT).every((word) => !word.includes('（')),
    ).toBe(true)
    expect(LEVEL_TEXT.danger).toBe('危急')
    expect(panelDanger?.label).not.toBe(LEVEL_TEXT.danger)
  })
})
