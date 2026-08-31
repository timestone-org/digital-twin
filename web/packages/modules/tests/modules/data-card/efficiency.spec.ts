/**
 * @fileoverview 验收：北京 2D 屏左上角那块「能源银行效率」的两个节点配置——
 * 上面一只 COP 弧（满弧 + 指针 + 光谱色标），下面三张卡（圆点名称｜占比 /
 * 大读数 + 单位 / 分段格子条）。
 *
 * ⚠ 守的是「配了不生效」：部件字段键拼错、枚举取值落在名单外，两侧都不报错，
 * 那一项就是默认值，而墙上看着「差不多对」。
 * ⚠ 配置件与用例同仓，改配置就得改这里，两边不会各自漂。
 */
import type { ConfigField } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetCardParts } from '../../../src/cardParts/registry'
import DataCard from '../../../src/modules/data-card/Component.vue'
import cardManifest from '../../../src/modules/data-card/manifest'
import { registerBuiltinCardParts } from '../../../src/modules/data-card/parts'
import GaugeCard from '../../../src/modules/gauge-card/Component.vue'
import gaugeManifest from '../../../src/modules/gauge-card/manifest'
import FIXTURE from './efficiency.fixture.json'

type Bag = Record<string, unknown>

const GAUGE = FIXTURE.gauge as Bag
const CARD = FIXTURE.card as Bag

/** 一份清单里所有键：顶层、簇内子键、数组行字段，摊平成一张表。 */
function keysOf(schema: readonly ConfigField[]): Set<string> {
  const out = new Set<string>()
  for (const field of schema) {
    out.add(field.key)
    for (const child of field.fields ?? []) out.add(child.key)
    for (const row of field.itemSchema ?? []) out.add(row.key)
  }
  return out
}

const GAUGE_KEYS = keysOf(gaugeManifest.configSchema)
const CARD_KEYS = keysOf(cardManifest.configSchema)

beforeEach(registerBuiltinCardParts)
afterEach(__resetCardParts)

describe('两份配置都落在清单里', () => {
  it('仪表那份的键都在清单里', () => {
    expect(Object.keys(GAUGE).filter((key) => !GAUGE_KEYS.has(key))).toEqual([])
  })

  it('卡片那份的键都在清单里，格与部件两层也算', () => {
    const rows = [...(CARD.cells as Bag[]), ...(CARD.parts as Bag[])].flatMap(
      (row) => Object.keys(row),
    )

    expect(
      [...new Set([...Object.keys(CARD), ...rows])].filter(
        (key) => !CARD_KEYS.has(key),
      ),
    ).toEqual([])
  })
})

describe('仪表画成了满弧 + 指针 + 光谱', () => {
  function gauge(value: unknown = 1.2) {
    return mount(GaugeCard, {
      props: {
        config: GAUGE,
        values: { gaugeValues: [{ value }] },
        meta: { slots: { 'gaugeValues[0].value': { state: 'ok' } } },
      },
    })
  }

  it('整条弧上色而不是按读数裁', () => {
    expect(gauge().get('.gc-arc__fill').classes()).toContain(
      'gc-arc__fill--full',
    )
  })

  it('画出指针', () => {
    expect(gauge().find('.gc-needle__blade').exists()).toBe(true)
  })

  it('四档色标都摆上了，红在左青在右', () => {
    const stops = gauge().findAll('stop')

    expect(stops).toHaveLength(4)
    expect(stops[0]?.attributes('stop-color')).toBe('var(--state-danger)')
    expect(stops[3]?.attributes('stop-color')).toBe('var(--accent-secondary)')
  })

  // ⚠ 色标按百分比定位，故量程口径变了色区就跟着挪；COP 的 0–4 是业务口径
  it('量程是 COP 的 0–4，读数与说明都在', () => {
    const wrapper = gauge()

    expect(wrapper.text()).toContain('1.2')
    expect(wrapper.text()).toContain('系统热能 COP')
  })
})

describe('三张卡摆成了图上那个样子', () => {
  async function cards(rows: readonly Bag[]) {
    const wrapper = mount(DataCard, {
      props: { config: CARD, values: { cellValues: [...rows] } },
    })
    // ⚠ 部件是异步组件：只 `flushPromises` 等不到 `import()` 落地
    await vi.dynamicImportSettled()
    await flushPromises()
    return wrapper
  }

  const ROWS = [
    { value: 2578, ratio: 37.5 },
    { value: 1273, ratio: 18.5 },
    { value: 3020, ratio: 44 },
  ]

  it('三张卡，每张一个圆点名称', async () => {
    const wrapper = await cards(ROWS)

    expect(wrapper.findAll('.dc-cell')).toHaveLength(3)
    expect(wrapper.findAll('.dc-label__dot')).toHaveLength(3)
  })

  it('逐张换基色，圆点与左色条跟着走', async () => {
    const wrapper = await cards(ROWS)
    const styles = wrapper
      .findAll('.dc-cell')
      .map((one) => one.attributes('style') ?? '')

    expect(styles[0]).toContain('--dc-cell-color: var(--state-success)')
    expect(styles[1]).toContain('--dc-cell-color: var(--state-warning)')
    expect(styles[2]).toContain('--dc-cell-color: var(--state-danger)')
  })

  it('大读数带千分位与单位', async () => {
    const wrapper = await cards(ROWS)

    expect(wrapper.findAll('.dc-value__num')[0]?.text()).toBe('2,578')
    expect(wrapper.findAll('.dc-value__unit')[0]?.text()).toBe('kWh')
  })

  it('右上角摆占比读数', async () => {
    const wrapper = await cards(ROWS)
    const extras = wrapper.findAll('.dc-extra')

    expect(extras).toHaveLength(3)
    expect(extras[0]?.text()).toContain('37.5')
    expect(extras[0]?.text()).toContain('%')
  })

  // ⚠ 16 格是配置里写死的：改格数会让「亮几格」整体变，而读数一个没动
  it('分段格子按占比点亮：16 格里 37.5% 亮 6 格', async () => {
    const wrapper = await cards(ROWS)
    const rows = wrapper.findAll('.dc-cell')

    expect(rows[0]?.findAll('.dt-meter__block')).toHaveLength(16)
    expect(rows[0]?.findAll('.dt-meter__block--on')).toHaveLength(6)
    expect(rows[1]?.findAll('.dt-meter__block--on')).toHaveLength(3)
    expect(rows[2]?.findAll('.dt-meter__block--on')).toHaveLength(7)
  })

  // ⚠ 没接占比槽时不能画成 0 格：一条满负荷的支路看着像停了
  it('没接占比时整条不画，也不画成零格', async () => {
    const wrapper = await cards([{ value: 2578 }])

    expect(wrapper.find('.dt-meter__block').exists()).toBe(false)
    expect(wrapper.find('.dc-value__num').text()).toBe('2,578')
  })
})
