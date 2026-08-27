/**
 * @fileoverview 五套预设逐个真挂一遍：档位类、逐格 CSS 变量、外层网格，以及它声称要画的
 * 那几件是不是真在 DOM 里。末尾一段把关键取值逐个对回参考仓的选择器——预设是照设计文档
 * 写的，再拿预设去对那份文档是循环验证，只有对回源码才算数。
 *
 * ⚠ 预设的数据面（键集合、簇的键序、颜色写法）在 `presets.test.ts`；这一份守的是
 * 「配出来的观感真画得出来」——预设写对了而模板没接那一档，两边都不报错。
 * ⚠ 期望表按 id 逐条对上，新增一套预设而忘了写期望时，这里当场红。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/info-card/Component.vue'
import { CARD_SLOT_KEY } from '../../../src/modules/info-card/cells'
import manifest from '../../../src/modules/info-card/manifest'
import { INFO_CARD_PRESETS } from '../../../src/modules/info-card/presets'
import { configDefaults } from '../../../src/shared/config'

const DEFAULTS = configDefaults(manifest.configSchema)

// 两格都带图与 emoji：角标档与图标容器档各有得画，缺图那一条分支另有专门的用例
const ITEMS = [
  {
    label: '温度',
    unit: '℃',
    precision: 1,
    emoji: '🌡️',
    icon: '/i/temp.png',
    emitValue: 't1',
  },
  {
    label: '湿度',
    unit: '%',
    precision: 0,
    emoji: '💧',
    icon: '/i/hum.png',
    emitValue: 'h1',
  },
]

// aux 是「对比值」子槽：涨跌块只有它在场才画得出来
const VALUES = {
  [CARD_SLOT_KEY]: [
    { value: 23.4, aux: 20 },
    { value: 61, aux: 65 },
  ],
}

/** 一套预设该看到什么。 */
interface Expected {
  /** 必须挂在卡片根上的档位类。 */
  classes: string[]
  /** 必须出现在格的内联样式里的片段。 */
  vars: string[]
  /** 必须出现在卡片根内联样式里的片段（网格只由 gridStyle 一处下发）。 */
  grid: string[]
  /** 必须画出来的件。 */
  present: string[]
  /** 必须没有的件。 */
  absent: string[]
}

const EXPECTED: Record<string, Expected> = {
  'kpi-single': {
    classes: [
      'ic--layout-single',
      'ic--shell-plain',
      'ic--hover-none',
      'ic--align-center',
      'ic--icon-corner',
      'ic--font-digit',
    ],
    vars: [
      '--ic-cell-px: 0px',
      '--ic-cell-py: 0px',
      '--ic-value-glow: 12px',
      '--ic-unit-size: 13px',
      '--ic-icon-size: 20px',
      '--ic-icon-opacity: 0.85',
    ],
    grid: ['grid-template-columns: minmax(0, 1fr)', 'padding: 4px 12px'],
    present: ['.ic-corner', '.ic-compare', '.ic-cell--label-below'],
    absent: ['.ic-badge'],
  },
  'kpi-grid': {
    classes: [
      'ic--layout-grid',
      'ic--shell-accent',
      'ic--hover-lift',
      'ic--align-left',
      'ic--icon-none',
    ],
    vars: [
      '--ic-cell-px: 12px',
      '--ic-cell-py: 8px',
      '--ic-value-glow: 10px',
      '--ic-unit-size: 12px',
    ],
    grid: [
      'grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))',
      'gap: 10px 10px',
      'padding: 6px 10px',
    ],
    present: ['.ic-cell--label-above', '.ic-value'],
    absent: ['.ic-corner', '.ic-badge', '.ic-compare'],
  },
  'icon-grid': {
    classes: [
      'ic--layout-grid',
      'ic--icon-badge',
      'ic--icon-at-left',
      'ic--align-left',
      'ic--shell-plain',
      'ic--hover-none',
    ],
    vars: [
      '--ic-icon-size: 40px',
      '--ic-icon-radius: 50%',
      '--ic-label-size: 13px',
      '--ic-label-opacity: 0.6',
      '--ic-label-color: var(--text-title)',
      '--ic-value-size: 26px',
      '--ic-unit-color: var(--text-primary)',
      '--ic-unit-opacity: 0.5',
    ],
    grid: [
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
      'gap: 0px 0px',
      'padding: 0px;',
    ],
    present: ['.ic-badge', '.ic-badge__img'],
    absent: ['.ic-corner', '.ic-compare'],
  },
  'icon-column': {
    classes: ['ic--icon-badge', 'ic--icon-at-top', 'ic--align-center'],
    vars: ['--ic-icon-size: 40px', '--ic-value-size: 26px'],
    grid: ['grid-template-columns: repeat(2, minmax(0, 1fr))'],
    present: ['.ic-badge'],
    absent: ['.ic-corner', '.ic-compare'],
  },
  'plain-grid': {
    classes: [
      'ic--layout-grid',
      'ic--shell-plain',
      'ic--hover-none',
      'ic--icon-none',
      'ic--align-left',
    ],
    vars: ['--ic-cell-px: 8px', '--ic-cell-py: 6px'],
    grid: ['gap: 8px 8px', 'padding: 6px 8px'],
    present: ['.ic-label', '.ic-value'],
    absent: ['.ic-corner', '.ic-badge', '.ic-compare'],
  },
}

/** 一套都没写期望时的底；哪一套漏了由那条 id 覆盖闸当场报出来。 */
const NOTHING_EXPECTED: Expected = {
  classes: [],
  vars: [],
  grid: [],
  present: [],
  absent: [],
}

/**
 * 取一套预设的期望。
 * @param id 预设 id
 */
function expectedOf(id: string): Expected {
  return EXPECTED[id] ?? NOTHING_EXPECTED
}

function render(config: Record<string, unknown>) {
  return mount(Component, {
    props: {
      config: { ...DEFAULTS, items: ITEMS, ...config },
      values: VALUES,
    },
  })
}

/** 一套预设配出来的卡片。 */
function withPreset(id: string): ReturnType<typeof render> {
  const preset = INFO_CARD_PRESETS.find((item) => item.id === id)
  return render({ ...preset?.config })
}

describe('五套预设逐个挂起来', () => {
  it('期望表覆盖了每一套，一套都不落下', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      INFO_CARD_PRESETS.map((preset) => preset.id).sort(),
    )
  })

  it.each(INFO_CARD_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s 画出它声称的那几件',
    (id, preset) => {
      const want = expectedOf(id)
      const wrapper = render({ ...preset.config })
      const card = wrapper.get('.ic-card')
      const grid = card.attributes('style') ?? ''
      const vars = wrapper.get('.ic-cell').attributes('style') ?? ''

      expect(card.classes()).toEqual(expect.arrayContaining(want.classes))
      expect(want.vars.filter((at) => !vars.includes(at))).toEqual([])
      expect(want.grid.filter((at) => !grid.includes(at))).toEqual([])
      expect(want.present.filter((at) => !wrapper.find(at).exists())).toEqual(
        [],
      )
      expect(want.absent.filter((at) => wrapper.find(at).exists())).toEqual([])
    },
  )

  it('五套都摆得出两格，没有一套把格吃掉', () => {
    const counts = INFO_CARD_PRESETS.map(
      (preset) => withPreset(preset.id).findAll('.ic-cell').length,
    )

    expect(counts).toEqual([2, 2, 2, 2, 2])
  })
})

describe('逐值对回参考仓的那几处', () => {
  it('单值大字的留白是参考仓 kpi-card 那一处 padding，格自己不再留白', () => {
    const wrapper = withPreset('kpi-single')
    const grid = wrapper.get('.ic-card').attributes('style') ?? ''
    const cell = wrapper.get('.ic-cell').attributes('style') ?? ''

    // .kpi-body { padding: 4px 12px }：整块留白全在容器上
    expect(grid).toContain('padding: 4px 12px')
    expect(cell).toContain('--ic-cell-px: 0px')
    expect(cell).toContain('--ic-cell-py: 0px')
  })

  it('单值大字的单位十三号、角标二十像素压到八五成', () => {
    const cell = withPreset('kpi-single').get('.ic-cell').attributes('style')

    // .kpi-unit { font-size: 13px }；.kpi-icon { width/height: 20px; opacity: .85 }
    expect(cell).toContain('--ic-unit-size: 13px')
    expect(cell).toContain('--ic-icon-size: 20px')
    expect(cell).toContain('--ic-icon-opacity: 0.85')
  })

  it('指标小卡的辉光十像素，悬停是带位移的上浮档', () => {
    const wrapper = withPreset('kpi-grid')

    // .kpi-cell__value { text-shadow: 0 0 10px … }；.kpi-cell:hover 带 translateY(-2px)
    expect(wrapper.get('.ic-cell').attributes('style')).toContain(
      '--ic-value-glow: 10px',
    )
    expect(wrapper.get('.ic-card').classes()).toContain('ic--hover-lift')
  })

  it('图标网格的两列、零间距与四十像素圆形容器逐个对上', () => {
    const wrapper = withPreset('icon-grid')

    // resolveGridStyle 的 columns 缺省 '2'；--ikg-gap 缺省 0；iconSize 缺省 40
    expect(wrapper.get('.ic-card').attributes('style')).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    )
    expect(wrapper.get('.ic-card').attributes('style')).toContain(
      'gap: 0px 0px',
    )
    expect(wrapper.get('.ic-cell').attributes('style')).toContain(
      '--ic-icon-size: 40px',
    )
  })

  it('图标两套的标签是标题色压到六成、读数钉死二十六号且不带辉光', () => {
    const cell = withPreset('icon-grid').get('.ic-cell').attributes('style')

    // .ikg-cell__label { color: var(--text-title); opacity: .6 }；--ikg-value-size 缺省 26
    expect(cell).toContain('--ic-label-color: var(--text-title)')
    expect(cell).toContain('--ic-label-opacity: 0.6')
    expect(cell).toContain('--ic-value-size: 26px')
    expect(cell).not.toContain('--ic-value-glow')
  })

  it('闪烁落在读数那一件上，单位不跟着一起闪', () => {
    const wrapper = render({
      ...INFO_CARD_PRESETS[1]?.config,
      rules: [
        {
          op: 'gt',
          value: 10,
          level: 'danger',
          color: '',
          label: '',
          blink: true,
        },
      ],
    })

    // .kpi-cell__value--blink / .ikg-cell__value--blink 都只挂在读数那个 span 上
    expect(wrapper.get('.ic-value').classes()).toContain('ic-value--blink')
    expect(wrapper.get('.ic-unit').classes()).not.toContain('ic-value--blink')
  })
})
