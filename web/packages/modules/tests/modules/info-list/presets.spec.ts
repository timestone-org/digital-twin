/**
 * @fileoverview 八套预设逐个真挂一遍：修饰类、CSS 变量、以及它声称要画的那几件是不是
 * 真在 DOM 里。再把每个枚举字段的每一档各挂一次，兜住「某一档模板忘了写」这类静默留白。
 *
 * ⚠ 预设的数据面（键集合、簇的键序、颜色写法）在 `presets.test.ts`；这一份守的是
 * 「配出来的观感真画得出来」——预设写对了而模板没接那一档，两边都不报错。
 * ⚠ 期望表按 id 逐条对上，新增一套预设而忘了写期望时，这里当场红。
 */
import type { ConfigField } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/info-list/Component.vue'
import manifest from '../../../src/modules/info-list/manifest'
import { INFO_LIST_PRESETS } from '../../../src/modules/info-list/presets'
import { LIST_SLOT_KEY } from '../../../src/modules/info-list/rows'
import { configDefaults } from '../../../src/shared/config'
import ScrollList from '../../../src/shared/ScrollList.vue'

const DEFAULTS = configDefaults(manifest.configSchema)

const ITEMS = [
  {
    label: '一号机',
    unit: 'kWh',
    precision: 1,
    tag: '电制冷',
    group: '蓄热',
    range: { min: 0, max: 200, target: 150 },
    desc: '季度巡检',
    emitValue: 'u1',
  },
  {
    label: '二号机',
    unit: 'kWh',
    precision: 1,
    tag: '燃气',
    group: '蓄冷',
    range: { min: 0, max: 200, target: 120 },
    desc: '待复检',
    emitValue: 'u2',
  },
]

const VALUES = {
  [LIST_SLOT_KEY]: [
    {
      value: 120,
      aux: 2,
      aux2: 64,
      status: 1,
      text: '季度巡检',
      time: '08:30',
      extra1: 12,
      extra2: 55,
      extra3: 8,
    },
    {
      value: 60,
      aux: 1,
      aux2: 30,
      status: 3,
      text: '待复检',
      time: '09:10',
      extra1: 6,
      extra2: 41,
      extra3: 3,
    },
  ],
}

/** 只判上限的一条规则，给「活动告警」那一套现场补上——它出厂不带阈值。 */
const OVER_RULE = [
  {
    op: 'gt',
    value: 100,
    level: 'danger',
    color: '',
    label: '超上限',
    blink: false,
  },
]

/** 一套预设该看到什么。 */
interface Expected {
  /** 必须挂在列表根上的档位类。 */
  classes: string[]
  /** 必须出现在根内联样式里的片段。 */
  vars: string[]
  /** 必须画出来的件。 */
  present: string[]
  /** 必须没有的件。 */
  absent: string[]
  /** 每项滚过视区的秒数。 */
  speed: number
  /** 这一套要现场补的配置（出厂不带阈值的那两套用得上）。 */
  extra: Record<string, unknown>
}

const EXPECTED: Record<string, Expected> = {
  'row-list': {
    classes: ['il--layout-stack', 'il--shell-divider', 'il--divider-dotted'],
    vars: [
      '--il-value-size: 16px',
      '--il-value-color: var(--accent-secondary)',
    ],
    present: ['.il-group--lead', '.il-icon-dot', '.il-text--label'],
    absent: ['.il-head', '.il-meter', '.il-badge', '.il-tabs'],
    speed: 3,
    extra: {},
  },
  'three-col': {
    classes: ['il--layout-columns', 'il--unit-column', 'il--hover-tint'],
    vars: ['--il-cols-tpl: minmax(0, 1.6fr)'],
    present: [
      '.il-head',
      '.il-group--col-name',
      '.il-group--col-value',
      '.il-group--col-unit',
      '.il-text--unit',
    ],
    absent: ['.il-group--lead', '.il-meter'],
    speed: 3,
    extra: {},
  },
  'target-badge-list': {
    classes: ['il--shell-divider', 'il--badge-outline'],
    vars: [
      '--il-value-size: 22px',
      '--il-value-glow: 10px',
      '--il-label-color: var(--text-primary)',
    ],
    present: ['.il-text--sub', '.il-text--value'],
    absent: ['.il-badge', '.il-meter', '.il-head'],
    speed: 3,
    extra: {},
  },
  'source-card': {
    classes: ['il--shell-accent', 'il--hover-lift'],
    vars: ['--il-meter-w: 128px', '--il-value-glow: 8px'],
    present: [
      '.il-group--lead',
      '.dt-status-badge',
      '.il-text--tag',
      '.il-meter',
      '.il-group--extras',
      '.il-text--extra',
    ],
    absent: ['.il-head', '.il-tabs'],
    speed: 5,
    extra: {},
  },
  'terminal-card': {
    classes: ['il--shell-card', 'il--group-tabs', 'il--hover-tint'],
    vars: ['--il-meter-w: 50px', '--il-meter-h: 3px', '--il-value-size: 17px'],
    present: ['.il-tabs', '.il-tab', '.il-text--tag', '.dt-status-badge'],
    absent: ['.il-section', '.il-head'],
    speed: 4,
    extra: {},
  },
  'vessel-card': {
    classes: ['il--shell-card', 'il--group-section', 'il--meter-dot'],
    vars: ['--il-value-size: 17px', '--il-meter-h: 4px'],
    present: ['.il-section', '.il-meter__dot', '.il-text--sub', '.il-meter'],
    absent: ['.il-tabs', '.il-badge'],
    speed: 4,
    extra: {},
  },
  'work-order': {
    classes: ['il--shell-edge', 'il--badge-solid'],
    vars: ['--il-label-color: var(--text-primary)'],
    present: ['.il-desc', '.il-text--time', '.il-badge--solid'],
    absent: ['.il-meter', '.il-tabs'],
    speed: 3,
    extra: {},
  },
  'alarm-rows': {
    classes: ['il--shell-edge', 'il--badge-dot'],
    vars: ['--il-value-size: 15px'],
    present: [
      '.il-group--lead',
      '.il-badge--dot',
      '.il-group--tail',
      '.il-group--tail2',
      '.il-text--alarmText',
      '.il-text--time',
    ],
    absent: ['.il-meter', '.il-head'],
    speed: 3,
    extra: { rules: OVER_RULE },
  },
}

/** 一套都没写期望时的底；哪一套漏了由上面那条 id 覆盖闸当场报出来。 */
const NOTHING_EXPECTED: Expected = {
  classes: [],
  vars: [],
  present: [],
  absent: [],
  speed: 0,
  extra: {},
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

describe('八套预设逐个挂起来', () => {
  it('期望表覆盖了每一套，一套都不落下', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      INFO_LIST_PRESETS.map((preset) => preset.id).sort(),
    )
  })

  it.each(INFO_LIST_PRESETS.map((preset) => [preset.id, preset] as const))(
    '%s 画出它声称的那几件',
    async (id, preset) => {
      const want = expectedOf(id)
      const wrapper = render({ ...preset.config, ...want.extra })
      await nextTick()
      const list = wrapper.get('.il-list')
      const style = list.attributes('style') ?? ''

      expect(list.classes()).toEqual(expect.arrayContaining(want.classes))
      for (const fragment of want.vars) expect(style).toContain(fragment)
      expect(want.present.filter((at) => !wrapper.find(at).exists())).toEqual(
        [],
      )
      expect(want.absent.filter((at) => wrapper.find(at).exists())).toEqual([])
      expect(wrapper.getComponent(ScrollList).props('secondsPerItem')).toBe(
        want.speed,
      )
    },
  )
})

describe('两套出厂不带阈值的预设', () => {
  it('活动告警那一套没配规则时一行都不留，写的是无告警而不是无数据', async () => {
    const preset = INFO_LIST_PRESETS.find((item) => item.id === 'alarm-rows')
    const wrapper = render({ ...preset?.config })
    await nextTick()

    expect(wrapper.findAll('.il-row')).toHaveLength(0)
    expect(wrapper.get('.il-empty').text()).toBe('无活动告警')
  })

  it('指标维护表那一套的徽章要配了规则才出，副读数取的是行内目标值', async () => {
    const preset = INFO_LIST_PRESETS.find(
      (item) => item.id === 'target-badge-list',
    )
    const bare = render({ ...preset?.config })
    const ruled = render({ ...preset?.config, rules: OVER_RULE })
    await nextTick()

    expect(bare.find('.il-badge').exists()).toBe(false)
    expect(bare.get('.il-text--sub').text()).toContain('目标')
    expect(bare.get('.il-text--sub').text()).toContain('150')
    expect(ruled.get('.il-badge').text()).toBe('超上限')
  })
})

describe('容器卡与工单条目的两处取值', () => {
  it('容器卡的两条进度条各自取值，占比与液位不是同一个数', async () => {
    const preset = INFO_LIST_PRESETS.find((item) => item.id === 'vessel-card')
    const wrapper = render({ ...preset?.config })
    await nextTick()
    const first = wrapper.findAll('.il-row')[0]

    expect(first?.findAll('.il-meter')).toHaveLength(2)
    expect(first?.findAll('.il-meter__pct').map((node) => node.text())).toEqual(
      ['60%', '64%'],
    )
  })

  it('工单三档状态由三条等值规则给出文案，时刻取的是绑定文本', async () => {
    const preset = INFO_LIST_PRESETS.find((item) => item.id === 'work-order')
    const wrapper = render({ ...preset?.config })
    await nextTick()

    expect(
      wrapper.findAll('.il-badge--solid').map((node) => node.text()),
    ).toEqual(['已完成', '执行中'])
    expect(
      wrapper.findAll('.il-text--time').map((node) => node.text()),
    ).toEqual(['08:30', '09:10'])
  })
})

/** 一档要挂一次的配置。 */
interface EnumCase {
  at: string
  config: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 一层子字段自己的缺省，用来当「只改这一个键」的底。 */
function rowDefaults(fields: readonly ConfigField[]): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) row[field.key] = field.default
  }
  return row
}

function casesOfChild(
  parent: ConfigField,
  child: ConfigField,
  wrap: (row: Record<string, unknown>) => unknown,
): EnumCase[] {
  const base = rowDefaults(parent.fields ?? parent.itemSchema ?? [])
  return (child.options ?? []).map((option) => ({
    at: `${parent.key}.${child.key}=${String(option.value)}`,
    config: { [parent.key]: wrap({ ...base, [child.key]: option.value }) },
  }))
}

/**
 * 一个顶层枚举字段的每一档各一例。
 * @param field 顶层字段
 */
function casesOfTop(field: ConfigField): EnumCase[] {
  if (field.type !== 'enum') return []
  return (field.options ?? []).map((option) => ({
    at: `${field.key}=${String(option.value)}`,
    config: { [field.key]: option.value },
  }))
}

/**
 * 一个字段下那一层子枚举的每一档各一例：簇内子键与数组行内字段都算。
 * @param field 顶层字段
 */
function casesOfNested(field: ConfigField): EnumCase[] {
  const inCluster = (field.fields ?? [])
    .filter((child) => child.type === 'enum')
    .flatMap((child) => casesOfChild(field, child, (row) => row))
  const inRows = (field.itemSchema ?? [])
    .filter((child) => child.type === 'enum')
    .flatMap((child) => casesOfChild(field, child, (row) => [row]))
  return [...inCluster, ...inRows]
}

/** 每个枚举字段的每一档各一例，簇内与数组行内的枚举也算。 */
function enumCases(): EnumCase[] {
  return manifest.configSchema.flatMap((field) => [
    ...casesOfTop(field),
    ...casesOfNested(field),
  ])
}

describe('枚举档位穷举', () => {
  it('扫出来的档位不是空的，穷举本身没有空转', () => {
    const found = enumCases()

    expect(found.length).toBeGreaterThan(60)
    expect(found.map((item) => item.at)).toContain('rowShape.lead=badge')
    expect(found.map((item) => item.at)).toContain('rowLines.left=meter2')
  })

  it('每一档都挂得起来且根节点有内容——某一档模板忘了写就是一片留白', () => {
    const blank = enumCases().filter((item) => {
      const wrapper = render({
        ...asRecord(INFO_LIST_PRESETS[3]?.config),
        ...item.config,
      })
      const empty = wrapper.get('.il-list').element.children.length === 0
      wrapper.unmount()
      return empty
    })

    expect(blank.map((item) => item.at)).toEqual([])
  })
})
