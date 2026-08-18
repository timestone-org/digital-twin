/**
 * @fileoverview 守按钮清单的声明：它是控件不是装饰（自己上抛事件、不走整块兜底、
 * 不套平台卡片框）、不取任何数，以及图标选项里的每一个名字都在 DtIcon 注册表里——
 * 没登记的名字既不报错也不渲染，只会留下一个永远空着的图标位。
 */
import { isIconName } from '@dt/ui'
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/action-button/manifest'
import { BUTTON_ICONS } from '../../../src/modules/action-button/options'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function optionValues(key: string): unknown[] {
  return (field(key)?.options ?? []).map((option) => option.value)
}

const CONFIG_KEYS = new Set(manifest.configSchema.map((item) => item.key))

describe('按钮清单的声明', () => {
  it('是控件模块：不套卡片框，也不许再配一层平台外观', () => {
    expect(manifest.type).toBe('action-button')
    expect(manifest.category).toBe('控件')
    expect(manifest.chrome).toBe('bare')
    expect(manifest.chromeConfigurable).toBe(false)
  })

  it('自己上抛联动事件，不借整块可点那条兜底', () => {
    expect(manifest.emitsInteractions).toBe(true)
    // ⚠ 两个都开的话，按钮外的空白也能点，且同一次点击会上抛两遍
    expect(manifest.hostClickable).toBeUndefined()
  })

  it('不取任何数：按钮的语义是「点了做什么」，不是「显示什么」', () => {
    expect(manifest.bindings).toEqual([])
    expect(manifest.ownsStatusDisplay).toBeUndefined()
  })

  it('每个配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })

  it('图标选项全部是已登记的名字，空串是「不要图标」那一档', () => {
    const unregistered = BUTTON_ICONS.map((option) => option.value).filter(
      (name) => name !== '' && !isIconName(name),
    )

    expect(unregistered).toEqual([])
    expect(BUTTON_ICONS[0]?.value).toBe('')
  })
})

describe('按钮清单的取值范围', () => {
  it('五档风格与四档轮廓的取值与组件的白名单同源', () => {
    expect(optionValues('variant')).toEqual([
      'solid',
      'soft',
      'outline',
      'ghost',
      'hud',
    ])
    expect(optionValues('shape')).toEqual(['rounded', 'pill', 'sharp', 'cut'])
  })

  it('自定义主色只在选了自定义那一档时才露出来', () => {
    expect(field('accent')).toMatchObject({
      when: { key: 'tone', in: ['custom'] },
    })
  })

  it('圆角那一格在切角档也要露出来——它在那一档是斜边长', () => {
    expect(field('radius')).toMatchObject({
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

describe('按钮的外观预设', () => {
  it('三套预设都只写清单里有的键', () => {
    const unknown = (manifest.configPresets ?? []).flatMap((preset) =>
      Object.keys(preset.config)
        .filter((key) => !CONFIG_KEYS.has(key))
        .map((key) => `${preset.id}.${key}`),
    )

    expect(unknown).toEqual([])
  })

  it('预设的 id 唯一，撤销与断言才认得出是哪一套', () => {
    const ids = (manifest.configPresets ?? []).map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
  })
})
