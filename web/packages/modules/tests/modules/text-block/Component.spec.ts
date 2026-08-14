/**
 * @fileoverview 守文本块的渲染契约：换行拆行且空行不塌陷、数值一律夹到清单声明的
 * 范围（脏值不许上屏成 `-5px` / `0px`）、没配的排版项一个都不注入。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/text-block/Component.vue'
import textBlockManifest from '../../../src/modules/text-block/manifest'
import { configDefaults } from '../../../src/shared/config'

function render(config: Record<string, unknown> = {}) {
  return mount(Component, { props: { config, values: {} } })
}

function boxStyle(config: Record<string, unknown>): string {
  return render(config).get('.dt-text-block').attributes('style') ?? ''
}

function lineTexts(config: Record<string, unknown>): string[] {
  return render(config)
    .findAll('.dt-text-block__line')
    .map((line) => line.element.textContent ?? '')
}

describe('文本块的分行', () => {
  it('按换行逐行渲染', () => {
    expect(lineTexts({ text: '一号线\n二号线\n三号线' })).toEqual([
      '一号线',
      '二号线',
      '三号线',
    ])
  })

  it('Windows 粘过来的 CRLF 不在行尾留回车', () => {
    expect(lineTexts({ text: 'a\r\nb\nc' })).toEqual(['a', 'b', 'c'])
  })

  it('空行用不换行空格占位，行高不塌陷', () => {
    expect(lineTexts({ text: 'a\n\nb' })).toEqual(['a', '\u00a0', 'b'])
  })

  it('没配文字时渲染清单里的示例文本', () => {
    expect(lineTexts({})).toEqual(['示例文本'])
  })

  it('换了文字内容整块跟着更新', async () => {
    const wrapper = render({ text: '第一版' })
    await wrapper.setProps({ config: { text: '第二版' } })

    expect(wrapper.get('.dt-text-block__line').text()).toBe('第二版')
  })
})

describe('文本块的标题栏', () => {
  it('没填标题就不画标题栏', () => {
    expect(render({}).find('.module-title-bar').exists()).toBe(false)
  })

  it('填了标题才画，文字原样上屏', () => {
    const wrapper = render({ title: '机组说明' })

    expect(wrapper.get('.module-title-bar__text').text()).toBe('机组说明')
  })
})

describe('文本块的排版', () => {
  it('字号、行高、字重、内边距按配置上屏', () => {
    const style = boxStyle({
      fontSize: 24,
      lineHeight: 2,
      weight: 700,
      padding: 16,
    })

    expect(style).toContain('font-size: 24px')
    expect(style).toContain('line-height: 2')
    expect(style).toContain('font-weight: 700')
    expect(style).toContain('padding: 16px')
  })

  it('越界的字号被夹回上限，而不是原样上屏', () => {
    expect(boxStyle({ fontSize: 999 })).toContain('font-size: 120px')
  })

  it('负的内边距被夹成 0，不生成会被浏览器整条丢掉的声明', () => {
    expect(boxStyle({ padding: -5 })).toContain('padding: 0px')
  })

  it('非数字的字号回落缺省，不产出 NaNpx', () => {
    const style = boxStyle({ fontSize: '很大' })

    expect(style).toContain('font-size: 16px')
    expect(style).not.toContain('NaN')
  })

  it('对齐落到水平与垂直两处', () => {
    const style = boxStyle({ align: 'right', vAlign: 'bottom' })

    expect(style).toContain('text-align: right')
    expect(style).toContain('justify-content: flex-end')
  })

  it('清单里没有的对齐档一律回落，不让脏值挑走一档语义', () => {
    const style = boxStyle({ align: 'justify', vAlign: 'middle' })

    expect(style).toContain('text-align: left')
    expect(style).toContain('justify-content: center')
  })
})

describe('文本块「没配就不注入」的那几项', () => {
  it('字间距为 0 时不注入，交给样式表的内置字间距', () => {
    expect(boxStyle({})).not.toContain('letter-spacing')
    expect(boxStyle({ letterSpacing: 4 })).toContain('letter-spacing: 4px')
  })

  it('不透明度为 1 时不注入，免得凭空建一个层叠上下文', () => {
    expect(boxStyle({})).not.toContain('opacity')
    expect(boxStyle({ opacity: 0.7 })).toContain('opacity: 0.7')
  })

  it('默认字体不注入 font-family，继承外层正文字体', () => {
    expect(boxStyle({})).not.toContain('font-family')
    expect(boxStyle({ fontFamily: 'display' })).toContain(
      'font-family: var(--font-display)',
    )
    expect(boxStyle({ fontFamily: 'mono' })).toContain(
      'font-family: var(--font-mono)',
    )
  })

  it('背景留空不注入，填了才写', () => {
    expect(boxStyle({})).not.toContain('background')
    expect(boxStyle({ background: 'var(--surface-panel)' })).toContain(
      'background: var(--surface-panel)',
    )
  })
})

describe('文本块的溢出与辉光', () => {
  it('缺省硬裁，滚动档才给滚动条', () => {
    expect(boxStyle({})).toContain('overflow: hidden')
    expect(boxStyle({ overflow: 'scroll' })).toContain('overflow: auto')
  })

  it('省略号档仍然纵向裁剪，横向截断由行自己做', () => {
    const wrapper = render({ overflow: 'ellipsis' })

    expect(wrapper.get('.dt-text-block').classes()).toContain(
      'dt-text-block--ellipsis',
    )
    expect(wrapper.get('.dt-text-block').attributes('style')).toContain(
      'overflow: hidden',
    )
  })

  it('辉光是一个类，颜色跟着文字走', () => {
    expect(render({}).get('.dt-text-block').classes()).not.toContain(
      'dt-text-block--glow',
    )
    expect(render({ glow: true }).get('.dt-text-block').classes()).toContain(
      'dt-text-block--glow',
    )
  })

  it('空配置与清单缺省摊出来的配置渲染逐字相同', () => {
    const fromEmpty = render({}).html()
    const fromDefaults = render(configDefaults(textBlockManifest.configSchema))

    expect(fromDefaults.html()).toBe(fromEmpty)
  })
})
