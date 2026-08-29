/**
 * @fileoverview 验收：北京烟厂 2D 屏那三张 info-list 翻成可组合卡片之后，配置里
 * 每一个键都在清单里真存在，且真渲染得出来。
 *
 * ⚠ 这一条守的是「配了不生效」：部件字段键拼错（少个前缀、大小写不对）既不报错
 * 也不显示，那一项就是默认值，而墙上看着「差不多对」——最难发现的一类。
 * ⚠ 配置件与用例同仓，改配置就得改这里，两边不会各自漂。
 */
import type { ConfigField } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetCardParts } from '../../../src/cardParts/registry'
import Component from '../../../src/modules/data-card/Component.vue'
import manifest from '../../../src/modules/data-card/manifest'
import { registerBuiltinCardParts } from '../../../src/modules/data-card/parts'
import CARDS from './newcards.fixture.json'

type Bag = Record<string, unknown>

const CONFIGS = Object.values(CARDS.configs) as Bag[]

/** 清单里某个数组字段的行字段键。 */
function itemKeys(key: string): Set<string> {
  const field = manifest.configSchema.find((one) => one.key === key)
  return new Set((field?.itemSchema ?? []).map((one: ConfigField) => one.key))
}

/** 枚举字段 → 它允许的取值；卡片级与部件行两层合起来查。 */
const ENUM_OPTIONS = new Map<string, Set<string>>()
for (const field of [
  ...manifest.configSchema,
  ...(manifest.configSchema.find((one) => one.key === 'parts')?.itemSchema ??
    []),
]) {
  if (field.type !== 'enum' || field.options === undefined) continue
  ENUM_OPTIONS.set(
    field.key,
    new Set(field.options.map((one) => String(one.value))),
  )
}

/** 一袋配置里落在名单外的枚举取值。 */
function strayEnums(bag: Bag): string[] {
  return Object.entries(bag).flatMap(([key, value]) => {
    const allowed = ENUM_OPTIONS.get(key)
    return allowed !== undefined && !allowed.has(String(value))
      ? [`${key}=${String(value)}`]
      : []
  })
}

const CARD_KEYS = new Set(manifest.configSchema.map((one) => one.key))
const CELL_KEYS = itemKeys('cells')
const PART_KEYS = itemKeys('parts')

beforeEach(registerBuiltinCardParts)
afterEach(__resetCardParts)

describe('三张卡的配置都落在清单里', () => {
  it('扫得出三张来，别让下面几条对着空表报绿', () => {
    expect(CONFIGS).toHaveLength(3)
  })

  it('卡片级的键都在清单里', () => {
    const stray = CONFIGS.flatMap((cfg) =>
      Object.keys(cfg).filter((key) => !CARD_KEYS.has(key)),
    )

    expect([...new Set(stray)]).toEqual([])
  })

  it('格上的键都在清单里', () => {
    const stray = CONFIGS.flatMap((cfg) =>
      (cfg.cells as Bag[]).flatMap((cell) =>
        Object.keys(cell).filter((key) => !CELL_KEYS.has(key)),
      ),
    )

    expect([...new Set(stray)]).toEqual([])
  })

  // ⚠ 部件字段键拼错既不报错也不显示，那一项就是默认值
  it('部件上的键都在清单里', () => {
    const stray = CONFIGS.flatMap((cfg) =>
      (cfg.parts as Bag[]).flatMap((part) =>
        Object.keys(part).filter((key) => !PART_KEYS.has(key)),
      ),
    )

    expect([...new Set(stray)]).toEqual([])
  })

  it('枚举取值都在各自的选项名单里', () => {
    const stray = CONFIGS.flatMap((cfg) => [
      ...strayEnums(cfg),
      ...(cfg.parts as Bag[]).flatMap(strayEnums),
    ])

    expect(stray).toEqual([])
  })
})

describe('三张卡都渲染得出来', () => {
  /**
   * 按原卡的绑定形状注一份假值。
   * @param cfg 卡片配置
   */
  function values(cfg: Bag) {
    const slots = new Set(
      (cfg.parts as Bag[]).flatMap((part) =>
        typeof part['meter-slot'] === 'string'
          ? [part['meter-slot']]
          : typeof part['extra-slot'] === 'string'
            ? [part['extra-slot']]
            : [],
      ),
    )
    slots.add('value')
    return {
      cellValues: (cfg.cells as Bag[]).map((_cell, at) =>
        Object.fromEntries([...slots].map((key) => [key, 10 + at])),
      ),
    }
  }

  it.each(CONFIGS.map((cfg) => [String(cfg.title), cfg] as const))(
    '%s 摆得出每一格与每一件',
    async (_title, cfg) => {
      const wrapper = mount(Component, {
        props: { config: cfg, values: values(cfg) },
      })
      await vi.dynamicImportSettled()
      await flushPromises()

      const shown =
        cfg.grouping === 'tabs'
          ? (cfg.cells as Bag[]).filter(
              (cell) => cell.group === (cfg.cells as Bag[])[0]?.group,
            ).length
          : (cfg.cells as Bag[]).length
      expect(wrapper.findAll('.dc-cell')).toHaveLength(shown)
      // 一个部件都没画出来 = 配置里的键全没生效
      expect(wrapper.find('.dc-value').exists()).toBe(true)
    },
  )

  /**
   * 按标题取那一张；取不到就让用例当场红，而不是拿空配置往下跑。
   * @param title 卡片标题
   */
  function cardOf(title: string): Bag {
    const found = CONFIGS.find((one) => one.title === title)
    if (found === undefined) throw new Error(`配置件里没有「${title}」`)
    return found
  }

  it('末端负荷有三个页签，计数是全量', async () => {
    const cfg = cardOf('末端负荷')
    const wrapper = mount(Component, {
      props: { config: cfg, values: values(cfg) },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(wrapper.findAll('.dc-tabs__one').map((one) => one.text())).toEqual([
      '洗浴 3',
      '空调 3',
      '采暖 6',
    ])
  })

  it('能源源逐格摆得出三个附加字段', async () => {
    const cfg = cardOf('能源源')
    const wrapper = mount(Component, {
      props: { config: cfg, values: values(cfg) },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    // 每格四条 extra：能效 + 功率 + 温度 + 流量
    expect(wrapper.findAll('.dc-cell')).toHaveLength(8)
    expect(wrapper.findAll('.dc-extra')).toHaveLength(8 * 4)
  })

  it('储能容器逐格两条进度条，各读各的槽', async () => {
    const cfg = cardOf('储能容器')
    const wrapper = mount(Component, {
      props: { config: cfg, values: values(cfg) },
    })
    await vi.dynamicImportSettled()
    await flushPromises()

    expect(wrapper.findAll('.dc-meter')).toHaveLength(9 * 2)
  })
})
