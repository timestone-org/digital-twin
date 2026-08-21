/**
 * @fileoverview 守文本块清单的声明：纯装饰不取数、整块可点由宿主接管，以及每个
 * 枚举/数值字段的取值范围与组件里的白名单、夹取区间是同一份。
 */
import { describe, expect, it, vi } from 'vitest'

import manifest from '../../../src/modules/text-block/manifest'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function optionValues(key: string): unknown[] {
  return (field(key)?.options ?? []).map((option) => option.value)
}

describe('文本块清单的声明', () => {
  it('是装饰模块：不套卡片框、不是容器、不钉区域', () => {
    expect(manifest.type).toBe('text-block')
    expect(manifest.category).toBe('装饰')
    expect(manifest.chrome).toBe('bare')
    expect(manifest.isContainer).toBeUndefined()
    expect(manifest.region).toBeUndefined()
  })

  it('整块可点交给宿主，模块自己不上抛联动事件', () => {
    expect(manifest.hostClickable).toBe(true)
    expect(manifest.emitsInteractions).toBeUndefined()
  })

  it('自己不取数——要显示读数得用读数类模块', () => {
    expect(manifest.bindings).toEqual([])
  })

  it('每个配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })
})

describe('文本块清单的取值范围', () => {
  it('三档对齐与组件的白名单逐一对上', () => {
    expect(optionValues('align')).toEqual(['left', 'center', 'right'])
    expect(optionValues('vAlign')).toEqual(['top', 'center', 'bottom'])
  })

  it('字体三档不引入额外资源，第四档把字体名交给用户自己填', () => {
    expect(optionValues('fontFamily')).toEqual([
      'sans',
      'display',
      'mono',
      'custom',
    ])
  })

  it('自定义字体名只在选了自定义那一档时才露出来', () => {
    expect(field('fontFamilyCustom')).toMatchObject({
      type: 'string',
      default: '',
      when: { key: 'fontFamily', in: ['custom'] },
    })
  })

  it('辉光半径的范围就是组件的夹取区间，且只在辉光开着时露出来', () => {
    expect(field('glowRadius')).toMatchObject({
      default: 10,
      min: 0,
      max: 40,
      when: { key: 'glow', in: [true] },
    })
  })

  it('溢出三档：裁剪、滚动、逐行省略号', () => {
    expect(optionValues('overflow')).toEqual(['hidden', 'scroll', 'ellipsis'])
  })

  it('字号与行高的范围就是组件的夹取区间', () => {
    expect(field('fontSize')).toMatchObject({ default: 16, min: 8, max: 120 })
    expect(field('lineHeight')).toMatchObject({ default: 1.4, min: 1, max: 3 })
  })

  it('字重、内边距、不透明度的范围也与组件一致', () => {
    expect(field('weight')).toMatchObject({ default: 400, min: 100, max: 900 })
    expect(field('padding')).toMatchObject({ default: 8, min: 0, max: 48 })
    expect(field('opacity')).toMatchObject({ default: 1, min: 0, max: 1 })
  })

  it('文字缺省与组件里的兜底同值，脱开运行时也看得到示例文本', () => {
    expect(field('text')?.default).toBe('示例文本')
  })

  // ⚠ 图片块的同名字段是 0–100，两个模块的量纲不一样且都不许改，只能靠 help 说清
  it('不透明度的 help 写明量纲是 0–1', () => {
    expect(field('opacity')?.help).toContain('0–1')
  })

  it('字间距的 help 写明 0 是「沿用内置」而不是零字距', () => {
    const help = field('letterSpacing')?.help ?? ''

    expect(help).toContain('沿用内置字间距')
    expect(help).toContain('填 0 不等于零字距')
  })
})

describe('文本块清单的渲染组件', () => {
  it('渲染组件是异步装载的，清单本身不把它拽进首屏包体', async () => {
    const loaded = await vi.waitFor(() => manifest.component())

    expect(loaded.default).toBeDefined()
  })
})

describe('文本块的正文控件', () => {
  // 多行正文用 textarea 档：string 档一行输入框换行只能敲 \n，没人敲得出来
  it('text 字段是 textarea 档，缺省与帮助文案原样保留', () => {
    const text = field('text')

    expect(text?.type).toBe('textarea')
    expect(text?.default).toBe('示例文本')
    expect(text?.help).toContain('按行换行')
  })
})
