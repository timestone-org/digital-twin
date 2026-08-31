/**
 * @fileoverview 守页签栏清单的声明：它是控件不是装饰（自己上抛事件、不走整块兜底、
 * 不套平台卡片框）、只发「选项点击」这一档带值事件、不取任何数、出厂三格都带联动值，
 * 以及图标选项里的每一个名字都在 DtIcon 注册表里——没登记的名字既不报错也不渲染。
 */
import { isIconName } from '@dt/ui'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/nav-tabs/manifest'
import { TABS_ICONS } from '../../../src/modules/nav-tabs/options'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function optionValues(key: string): unknown[] {
  return (field(key)?.options ?? []).map((option) => option.value)
}

const CONFIG_KEYS = new Set(manifest.configSchema.map((item) => item.key))

const ITEM_SCHEMA = field('items')?.itemSchema ?? []

/** 出厂的那几格；`default` 是渲染兜底，属性面板也照它摆行。 */
const DEFAULT_ITEMS = (field('items')?.default ?? []) as Record<
  string,
  unknown
>[]

describe('页签栏清单的声明', () => {
  it('是控件模块：不套卡片框，也不许再配一层平台外观', () => {
    expect(manifest.type).toBe('nav-tabs')
    expect(manifest.category).toBe('控件')
    expect(manifest.chrome).toBe('bare')
    expect(manifest.chromeConfigurable).toBe(false)
  })

  it('自己上抛联动事件，不借整块可点那条兜底', () => {
    expect(manifest.emitsInteractions).toBe(true)
    // ⚠ 两个都开的话，格子之外的空白也能点，而那一次点击不带值
    expect(manifest.hostClickable).toBeUndefined()
  })

  it('只发「选项点击」：它是带值那一档，也是进场重放互斥组认的那一档', () => {
    expect(manifest.interactionEvents).toEqual(['select'])
  })

  it('不取任何数：页签的语义是「切到哪」，不是「显示什么」', () => {
    expect(manifest.bindings).toEqual([])
    expect(manifest.ownsStatusDisplay).toBeUndefined()
  })

  it('内容键是页签表与默认选中，其余都是观感——套样式时不许动到这两个', () => {
    expect(manifest.contentKeys).toEqual(['items', 'activeIndex'])
    expect(
      (manifest.contentKeys ?? []).filter((key) => !CONFIG_KEYS.has(key)),
    ).toEqual([])
  })

  it('每个配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })
})

describe('出厂的那几格', () => {
  it('出厂就是三格，空轨道看着像模块坏了', () => {
    expect(DEFAULT_ITEMS).toHaveLength(3)
  })

  it('每一格都带联动值，否则第一次试点击静默无反应', () => {
    const silent = DEFAULT_ITEMS.filter((item) => item.emitValue === undefined)

    expect(silent).toEqual([])
  })

  it('行内字段就是文案、联动值、图标与禁用四样', () => {
    expect(ITEM_SCHEMA.map((item) => item.key)).toEqual([
      'label',
      'emitValue',
      'icon',
      'disabled',
    ])
    expect(field('items')?.itemLabelKey).toBe('label')
  })

  it('图标选项全部是已登记的名字，空串是「不要图标」那一档', () => {
    const unregistered = TABS_ICONS.map((option) => option.value).filter(
      (name) => name !== '' && !isIconName(name),
    )

    expect(unregistered).toEqual([])
    expect(TABS_ICONS[0]?.value).toBe('')
  })
})

describe('页签栏清单的取值范围', () => {
  it('五档风格与四档轮廓的取值与组件的白名单同源', () => {
    expect(optionValues('variant')).toEqual([
      'track',
      'underline',
      'solid',
      'hud',
      'plain',
    ])
    expect(optionValues('shape')).toEqual(['rounded', 'pill', 'sharp', 'cut'])
  })

  it('默认选中的上界与页签数的上界同值，配得出来的都是真格', () => {
    expect(field('activeIndex')?.max).toBe(field('items')?.maxItems)
  })

  it('自定义主色只在选了自定义那一档时才露出来', () => {
    expect(field('accent')).toMatchObject({
      when: { key: 'tone', in: ['custom'] },
    })
  })

  it('每格圆角在切角档也要露出来——它在那一档是斜边长', () => {
    expect(field('itemRadius')).toMatchObject({
      when: { key: 'shape', in: ['rounded', 'cut'] },
    })
  })

  it('落位只在「按内容」尺寸时才有意义', () => {
    expect(field('align')).toMatchObject({
      when: { key: 'sizing', in: ['auto'] },
    })
    expect(field('vAlign')).toMatchObject({
      when: { key: 'sizing', in: ['auto'] },
    })
  })

  it('每条条件显示都指着一个真存在的同级字段', () => {
    const dangling = manifest.configSchema
      .filter((item) => item.when !== undefined)
      .filter((item) => !CONFIG_KEYS.has(item.when?.key ?? ''))
      .map((item) => item.key)

    expect(dangling).toEqual([])
  })
})

describe('页签栏的外观预设', () => {
  it('四套预设都只写清单里有的键', () => {
    const unknown = (manifest.configPresets ?? []).flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !CONFIG_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('预设只写观感、不碰页签表与默认选中', () => {
    const content = new Set(manifest.contentKeys ?? [])
    const touched = (manifest.configPresets ?? []).flatMap((preset) =>
      Object.keys(preset.config).filter((key) => content.has(key)),
    )

    expect(touched).toEqual([])
  })

  it('预设的 id 唯一，撤销与断言才认得出是哪一套', () => {
    const ids = (manifest.configPresets ?? []).map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})
