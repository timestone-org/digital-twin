/**
 * @fileoverview 守按钮的形态读取：脏配置一律夹回清单声明的范围、两个哨兵
 * （图标字号 0 = 跟随字号、留空的颜色不注入变量）的语义，以及读屏名称只在
 * 没有可见文案时才给——写反了会盖掉屏幕上的文字。
 */
import { describe, expect, it } from 'vitest'

import {
  BUTTON_TEXT_DEFAULT,
  readButtonSpec,
} from '../../../src/modules/action-button/look'

function vars(config: Record<string, unknown>): Record<string, unknown> {
  return readButtonSpec(config).vars as Record<string, unknown>
}

function classes(config: Record<string, unknown>): string[] {
  return readButtonSpec(config).classes
}

describe('按钮的缺省形态', () => {
  it('一份空配置也读得出一个像样的按钮', () => {
    const spec = readButtonSpec({})

    expect(spec.text).toBe(BUTTON_TEXT_DEFAULT)
    expect(spec.icon).toBe('')
    expect(spec.linkValue).toBe('')
    expect(spec.isDisabled).toBe(false)
    expect(spec.hasLabel).toBe(true)
  })

  it('缺省的类名是实心 / 圆角 / 图标在左 / 提亮 / 下沉 / 充满模块', () => {
    expect(classes({})).toEqual([
      'dt-button--solid',
      'dt-button--rounded',
      'dt-button--icon-left',
      'dt-button--hover-brighten',
      'dt-button--press-sink',
      'dt-button--fill',
    ])
  })

  it('没配的颜色、辉光与呼吸一个变量都不注入', () => {
    const injected = vars({})

    expect(injected['--btn-text']).toBeUndefined()
    expect(injected['--btn-glow']).toBeUndefined()
    expect(injected['--btn-pulse']).toBeUndefined()
  })
})

describe('按钮的语义色', () => {
  it('五档语义色各取一个主题变量，不写死颜色', () => {
    const accents = ['primary', 'success', 'warning', 'danger', 'neutral'].map(
      (tone) => vars({ tone })['--btn-accent'],
    )

    expect(accents).toEqual([
      'var(--accent-primary)',
      'var(--state-success)',
      'var(--state-warning)',
      'var(--state-danger)',
      'var(--text-secondary)',
    ])
  })

  it('预警档压深色字：黄底上的浅字读不出来', () => {
    expect(vars({ tone: 'warning' })['--btn-on']).toBe('var(--text-inverse)')
    expect(vars({ tone: 'primary' })['--btn-on']).toBe(
      'var(--text-on-emphasis)',
    )
  })

  it('自定义档用填的颜色，留空则回到主题强调色', () => {
    expect(vars({ tone: 'custom', accent: '#f0f' })['--btn-accent']).toBe(
      '#f0f',
    )
    expect(vars({ tone: 'custom', accent: '   ' })['--btn-accent']).toBe(
      'var(--accent-primary)',
    )
  })

  it('白名单外的语义色回落主色，不是没有颜色', () => {
    expect(vars({ tone: '紫色' })['--btn-accent']).toBe('var(--accent-primary)')
  })

  it('配了文字色才注入覆盖变量', () => {
    expect(vars({ textColor: '#fff' })['--btn-text']).toBe('#fff')
  })
})

describe('按钮的轮廓', () => {
  it('胶囊档给一个比任何高度都大的半径，由浏览器夹到半高', () => {
    expect(vars({ shape: 'pill' })['--btn-radius']).toBe('999px')
  })

  it('直角档把半径与切角一起归零', () => {
    expect(vars({ shape: 'sharp' })).toMatchObject({
      '--btn-radius': '0px',
      '--btn-cut': '0px',
    })
  })

  it('切角档把同一个旋钮读成斜边长，圆角归零', () => {
    expect(vars({ shape: 'cut', radius: 12 })).toMatchObject({
      '--btn-radius': '0px',
      '--btn-cut': '12px',
    })
  })

  it('圆角超出清单范围时夹回上限，不让整条声明作废', () => {
    expect(vars({ radius: 999 })['--btn-radius']).toBe('40px')
    expect(vars({ radius: -8 })['--btn-radius']).toBe('0px')
  })
})

describe('按钮的尺寸与文字', () => {
  it('字号与字重夹在清单范围内', () => {
    expect(vars({ fontSize: 0 })['--btn-font-size']).toBe('8px')
    expect(vars({ fontSize: 999 })['--btn-font-size']).toBe('64px')
    expect(vars({ fontWeight: 5000 })['--btn-weight']).toBe('900')
  })

  it('图标字号 0 是哨兵：跟着文字字号走', () => {
    expect(readButtonSpec({ fontSize: 20 }).iconSize).toBe(24)
    expect(readButtonSpec({ fontSize: 20, iconSize: 32 }).iconSize).toBe(32)
  })

  it('内边距、间距、描边粗细各自夹回范围', () => {
    expect(vars({ paddingX: 999, paddingY: -1, gap: 99 })).toMatchObject({
      '--btn-px': '64px',
      '--btn-py': '0px',
      '--btn-gap': '32px',
    })
    expect(vars({ borderWidth: 9 })['--btn-border-w']).toBe('4px')
  })

  it('字间距的脏值不上屏成负数', () => {
    expect(vars({ letterSpacing: -3 })['--btn-tracking']).toBe('0px')
  })
})

describe('按钮的动效', () => {
  it('开了辉光才注入半径，且夹在范围内', () => {
    expect(vars({ glow: true })['--btn-glow']).toBe('12px')
    expect(vars({ glow: true, glowRadius: 99 })['--btn-glow']).toBe('40px')
    expect(classes({ glow: true })).toContain('dt-button--glow')
  })

  it('开了呼吸才注入周期，太快的值夹回下限', () => {
    expect(vars({ pulse: true, pulseDuration: 0.1 })['--btn-pulse']).toBe(
      '0.6s',
    )
    expect(classes({ pulse: true })).toContain('dt-button--pulse')
  })

  it('只有扫光那一档才要多摆一层动画元素', () => {
    expect(readButtonSpec({ hover: 'sweep' }).hasSweep).toBe(true)
    expect(readButtonSpec({ hover: 'glow' }).hasSweep).toBe(false)
  })

  it('只有科技风才画四角刻线', () => {
    expect(readButtonSpec({ variant: 'hud' }).isHud).toBe(true)
    expect(readButtonSpec({ variant: 'soft' }).isHud).toBe(false)
  })
})

describe('按钮的排布', () => {
  it('充满模块时不做对齐——按钮就是那个矩形本身', () => {
    expect(readButtonSpec({ sizing: 'fill' }).hostStyle).toEqual({
      justifyContent: 'flex-start',
      alignItems: 'stretch',
    })
    expect(classes({ sizing: 'fill' })).toContain('dt-button--fill')
  })

  it('按内容尺寸时两个方向各自落位', () => {
    expect(
      readButtonSpec({ sizing: 'auto', align: 'right', vAlign: 'top' })
        .hostStyle,
    ).toEqual({ justifyContent: 'flex-end', alignItems: 'flex-start' })
    expect(classes({ sizing: 'auto' })).not.toContain('dt-button--fill')
  })

  it('图标位置落成一个类名，三档都认', () => {
    expect(classes({ iconPosition: 'top' })).toContain('dt-button--icon-top')
    expect(classes({ iconPosition: 'right' })).toContain(
      'dt-button--icon-right',
    )
  })
})

describe('按钮的文案与读屏名称', () => {
  it('有可见文案时不给 aria-label：它会盖掉屏幕上写的字', () => {
    expect(readButtonSpec({ text: '进入详情' }).ariaLabel).toBeUndefined()
  })

  it('只摆图标时拿悬停提示当名字，没提示就叫「按钮」', () => {
    expect(readButtonSpec({ text: '', hint: '返回总览' }).ariaLabel).toBe(
      '返回总览',
    )
    expect(readButtonSpec({ text: '   ' }).ariaLabel).toBe(BUTTON_TEXT_DEFAULT)
  })

  it('主副文案都空才算图标按钮，横向内边距要收掉', () => {
    expect(classes({ text: '' })).toContain('dt-button--icon-only')
    expect(classes({ text: '', subText: '子标题' })).not.toContain(
      'dt-button--icon-only',
    )
  })

  it('没登记的图标名回落成「不画图标」，不留一个永远空着的位置', () => {
    expect(readButtonSpec({ icon: 'no-such-icon' }).icon).toBe('')
    expect(readButtonSpec({ icon: 'gauge' }).icon).toBe('gauge')
  })

  it('联动值去掉首尾空白：一串空格不是一个能比中的值', () => {
    expect(readButtonSpec({ linkValue: '  line-1  ' }).linkValue).toBe('line-1')
    expect(readButtonSpec({ linkValue: '   ' }).linkValue).toBe('')
  })

  it('禁用只认真正的 true，配置里的字符串不算', () => {
    expect(readButtonSpec({ disabled: true }).isDisabled).toBe(true)
    expect(readButtonSpec({ disabled: 'true' }).isDisabled).toBe(false)
  })
})
