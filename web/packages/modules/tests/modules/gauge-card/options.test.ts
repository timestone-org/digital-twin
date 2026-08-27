/**
 * @fileoverview 守 gauge-card 取值表的四条契约：每张表自身自洽（档值唯一、白名单与表同序）、
 * 两张映射表逐档齐全、几处「档数以参考源码为准」的收敛被钉死，以及列数档值一律是字符串。
 * ⚠ 这几条错了一条都不报错：面板照样能选，渲染静默回落默认档，墙上只是少一块颜色。
 */
import { describe, expect, it } from 'vitest'

import {
  GAUGE_COLUMN_VALUES,
  GAUGE_COLUMNS,
  GAUGE_FILL_STYLE_VALUES,
  GAUGE_FILL_STYLES,
  GAUGE_LABEL_PLACE_VALUES,
  GAUGE_LABEL_PLACES,
  GAUGE_LABEL_TONE_COLORS,
  GAUGE_LABEL_TONE_VALUES,
  GAUGE_LABEL_TONES,
  GAUGE_LAYOUT_VALUES,
  GAUGE_LAYOUTS,
  GAUGE_READOUT_PLACE_VALUES,
  GAUGE_READOUT_PLACES,
  GAUGE_READOUT_VALUES,
  GAUGE_READOUTS,
  GAUGE_SHAPE_THICKNESS,
  GAUGE_SHAPE_VALUES,
  GAUGE_SHAPES,
  GAUGE_THICKNESS_MAX,
  GAUGE_THICKNESS_MIN,
  GAUGE_UNIT_PLACE_VALUES,
  GAUGE_UNIT_PLACES,
} from '../../../src/modules/gauge-card/options'

/** 一张待检的取值表：名字只为让失败信息说得出是哪一张。 */
interface OptionTable {
  name: string
  options: readonly { readonly value: string; readonly label: string }[]
  values: readonly string[]
}

const TABLES: readonly OptionTable[] = [
  { name: '形状', options: GAUGE_SHAPES, values: GAUGE_SHAPE_VALUES },
  { name: '排布', options: GAUGE_LAYOUTS, values: GAUGE_LAYOUT_VALUES },
  { name: '列数', options: GAUGE_COLUMNS, values: GAUGE_COLUMN_VALUES },
  {
    name: '填充上色',
    options: GAUGE_FILL_STYLES,
    values: GAUGE_FILL_STYLE_VALUES,
  },
  { name: '读数内容', options: GAUGE_READOUTS, values: GAUGE_READOUT_VALUES },
  {
    name: '读数位置',
    options: GAUGE_READOUT_PLACES,
    values: GAUGE_READOUT_PLACE_VALUES,
  },
  {
    name: '单位位置',
    options: GAUGE_UNIT_PLACES,
    values: GAUGE_UNIT_PLACE_VALUES,
  },
  {
    name: '标签位置',
    options: GAUGE_LABEL_PLACES,
    values: GAUGE_LABEL_PLACE_VALUES,
  },
  {
    name: '标签层级',
    options: GAUGE_LABEL_TONES,
    values: GAUGE_LABEL_TONE_VALUES,
  },
]

describe('取值表自身自洽', () => {
  it('一张表都没漏登记，表名也不重复', () => {
    expect(TABLES).toHaveLength(9)
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
    expect(Object.keys(GAUGE_LABEL_TONE_COLORS).sort()).toEqual(
      [...GAUGE_LABEL_TONE_VALUES].sort(),
    )
    expect(
      Object.values(GAUGE_LABEL_TONE_COLORS).every((color) =>
        color.startsWith('var(--'),
      ),
    ).toBe(true)
  })

  it('五档形状各有一个缺省厚度，逐档对回参考源码', () => {
    expect(Object.keys(GAUGE_SHAPE_THICKNESS).sort()).toEqual(
      [...GAUGE_SHAPE_VALUES].sort(),
    )
    expect(GAUGE_SHAPE_THICKNESS).toEqual({
      arc: 9,
      linear: 12,
      track: 18,
      tank: 0,
      thermometer: 0,
    })
  })

  it('吃厚度的三档缺省都落在可配区间里，储罐与温度计记零表示不吃厚度', () => {
    const inRange = (px: number): boolean =>
      px >= GAUGE_THICKNESS_MIN && px <= GAUGE_THICKNESS_MAX

    expect(GAUGE_THICKNESS_MIN).toBe(2)
    expect(GAUGE_THICKNESS_MAX).toBe(24)
    expect(
      (['arc', 'linear', 'track'] as const).every((shape) =>
        inRange(GAUGE_SHAPE_THICKNESS[shape]),
      ),
    ).toBe(true)
    expect(
      (['tank', 'thermometer'] as const).every(
        (shape) => GAUGE_SHAPE_THICKNESS[shape] === 0,
      ),
    ).toBe(true)
  })
})

describe('档数以参考源码为准', () => {
  it('形状五档：参考仓四档几何加那条粗轨道', () => {
    expect([...GAUGE_SHAPE_VALUES]).toEqual([
      'arc',
      'linear',
      'track',
      'tank',
      'thermometer',
    ])
  })

  it('排布三档，列数从一列起且档值一律是字符串——写成数字判不中，静默回落自动', () => {
    expect([...GAUGE_LAYOUT_VALUES]).toEqual(['auto', 'single', 'grid'])
    expect([...GAUGE_COLUMN_VALUES]).toEqual([
      'auto',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
    expect(
      GAUGE_COLUMNS.every((option) => typeof option.value === 'string'),
    ).toBe(true)
  })

  it('填充两档：弧与条是纯色，储罐与轨道是渐变', () => {
    expect([...GAUGE_FILL_STYLE_VALUES]).toEqual(['solid', 'gradient'])
  })

  it('读数四档，量程百分比与完成率不是一个数', () => {
    expect([...GAUGE_READOUT_VALUES]).toEqual([
      'value',
      'percent',
      'both',
      'none',
    ])
    expect([...GAUGE_READOUT_PLACE_VALUES]).toEqual([
      'center',
      'beside',
      'below',
    ])
  })

  it('单位两档，没有第三种贴法，也没有独占一列', () => {
    expect([...GAUGE_UNIT_PLACE_VALUES]).toEqual(['baseline', 'attached'])
    expect(GAUGE_UNIT_PLACE_VALUES).not.toContain('column')
  })

  it('标签四档，没有「隐藏」：留空标签文字即整行不渲染', () => {
    expect([...GAUGE_LABEL_PLACE_VALUES]).toEqual([
      'above',
      'below',
      'left',
      'right',
    ])
    expect(GAUGE_LABEL_PLACE_VALUES).not.toContain('hidden')
  })

  it('标签层级四档，与信息卡片同一套词', () => {
    expect([...GAUGE_LABEL_TONE_VALUES]).toEqual([
      'secondary',
      'primary',
      'title',
      'muted',
    ])
  })
})
