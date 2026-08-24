/**
 * @fileoverview 守卡片外观的发射规则：单位、简写串、只有某一档才注入，
 * 以及那条铁律——**未设置就一个变量都不产出**，渲染因此落回平台默认。
 */
import { describe, expect, it } from 'vitest'

import {
  CARD_BORDER_STYLE_OPTIONS,
  cardChromeClasses,
  cardVars,
  isChromeFrameless,
  mergeCardChrome,
  normalizeCardBorderStyle,
  resolveCardChrome,
} from '../src/cardVars'

describe('未设置 = 不写值', () => {
  it('空袋子一个变量都不产出，只剩四角那个恒挂的载体类', () => {
    expect(cardVars({})).toEqual({})
    expect(cardChromeClasses({})).toEqual(['dt-corners'])
  })

  it('空串与 null 一律当作没填', () => {
    expect(
      cardVars({ bg: '', border: null, titleBarColor: undefined }),
    ).toEqual({})
  })

  it('解析不出数的脏值不产出变量，绝不把 NaN 写进样式', () => {
    expect(cardVars({ radius: 'x', cornerSize: {}, hoverLift: [] })).toEqual({})
    expect(
      cardVars({ radius: Number.NaN, titleFontWeight: Number.NaN }),
    ).toEqual({})
  })

  it('对象与布尔进不了原样透传的那几项，硬塞会变成不生效的声明', () => {
    expect(cardVars({ bg: { r: 1 }, titleBarColor: true })).toEqual({})
  })
})

describe('数值的单位与容错', () => {
  it('长度类带 px、时长类带 s、比例类不带单位', () => {
    expect(
      cardVars({
        radius: 4,
        titlePulseDuration: 2.5,
        cornerOpacity: 0.9,
      }),
    ).toEqual({
      '--card-radius': '4px',
      '--card-title-anim-dur': '2.5s',
      '--card-corner-opacity': '0.9',
    })
  })

  it('数字串按数值解读，后端 JSON 里的 10 与 "10" 等价', () => {
    expect(cardVars({ cornerSize: '10' })).toEqual({
      '--card-corner-size': '10px',
    })
  })

  it('0 与负数是合法取值，角标偏移的平台现值就是 -1', () => {
    expect(cardVars({ cornerOffset: -1, titleLetterSpacing: 0 })).toEqual({
      '--card-corner-off': '-1px',
      '--card-title-ls': '0px',
    })
  })

  it('竖条与文字间距 ≤0 按未设置处理，否则竖条会贴死首字', () => {
    expect(cardVars({ titleGap: 0 })).toEqual({})
    expect(cardVars({ titleGap: 8 })).toEqual({ '--card-title-gap': '8px' })
  })
})

describe('布尔只认严格 true / false', () => {
  it('四角与标题只在显式关闭时注入 none，缺省与 true 都走继承', () => {
    expect(cardVars({ corners: true, showTitle: true })).toEqual({})
    expect(cardVars({ corners: false, showTitle: false })).toEqual({
      '--card-corner-display': 'none',
      '--card-title-display': 'none',
    })
  })

  it('字符串 false 不会把动效意外点亮', () => {
    expect(cardVars({ borderPulse: 'false', titlePulse: 'true' })).toEqual({})
  })

  it('竖条贯穿整行要满高与拉伸对齐两件套，只给高度不会被拉开', () => {
    expect(cardVars({ titleBarFull: true })).toEqual({
      '--card-title-bar-h': '100%',
      '--card-title-bar-align': 'stretch',
    })
  })
})

describe('简写串与逐档特例', () => {
  it('呼吸描边注入完整 animation 简写串，缺周期时用平台现值', () => {
    expect(cardVars({ borderPulse: true })['--card-anim']).toBe(
      'dt-card-breathe 6s ease-in-out infinite',
    )
    expect(cardVars({ borderPulse: true, borderPulseDuration: 3 })).toEqual({
      '--card-anim': 'dt-card-breathe 3s ease-in-out infinite',
      '--card-pulse-dur': '3s',
    })
  })

  it('标题脉动注入的是纯 keyframes 名，时长是另一个独立变量', () => {
    expect(cardVars({ titlePulse: true })).toEqual({
      '--card-title-anim': 'dt-title-pulse',
      '--card-title-text-anim': 'dt-title-glow-pulse',
    })
  })

  it('描边边数映射成 border-width 简写，缺省的四边不进表也就不注入', () => {
    expect(cardVars({ borderSide: 'top' })).toEqual({
      '--card-border-side': '1px 0 0',
    })
    expect(cardVars({ borderSide: 'all' })).toEqual({})
  })

  it('标题内边距是上左右下三值简写', () => {
    expect(cardVars({ titlePadding: [10, 12, 8] })).toEqual({
      '--card-title-pad': '10px 12px 8px',
    })
  })

  it('内边距缺一格就整条放弃，不产出半截非法的 padding', () => {
    expect(cardVars({ titlePadding: [10, 12] })).toEqual({})
    expect(cardVars({ titlePadding: [10, null, 8] })).toEqual({})
  })

  it('纵向对齐只有贴底一档要动，居中就是平台现值', () => {
    expect(cardVars({ titleAlign: 'bottom' })).toEqual({
      '--card-title-align': 'flex-end',
    })
    expect(cardVars({ titleAlign: 'center' })).toEqual({})
  })

  it('装饰带两档都让出余量，细线档只把斜纹层打成透明', () => {
    expect(cardVars({ titleRule: 'hatch' })).toEqual({
      '--card-title-rule-display': 'block',
      '--card-title-text-flex': '0 1 auto',
    })
    expect(cardVars({ titleRule: 'line' })['--card-title-rule-hatch']).toBe(
      'transparent',
    )
  })

  it('毛玻璃包成完整函数串，≤0 显式落成 none 而不是 blur(0px)', () => {
    expect(cardVars({ backdropBlur: 9.6 })).toEqual({
      '--card-backdrop-blur': 'blur(9.6px)',
    })
    expect(cardVars({ backdropBlur: 0 })).toEqual({
      '--card-backdrop-blur': 'none',
    })
  })

  it('配了悬停上浮才打开位移过渡，上浮 0 时不打开', () => {
    expect(cardVars({ hoverLift: 4 })).toEqual({
      '--card-hover-lift': '4px',
      '--card-hover-lift-dur': '0.3s',
    })
    expect(cardVars({ hoverLift: 0 })).toEqual({ '--card-hover-lift': '0px' })
  })

  it('颜色与字重原样透传，含 var(--token) 写法', () => {
    expect(
      cardVars({
        titleBarColor: 'var(--accent-primary)',
        titleFontWeight: 400,
      }),
    ).toEqual({
      '--card-title-bar': 'var(--accent-primary)',
      '--card-title-weight': '400',
    })
  })
})

describe('修饰类', () => {
  it('边框样式未设置就不写类，观感完全交给基类', () => {
    expect(cardChromeClasses({ borderStyle: '' })).toEqual(['dt-corners'])
  })

  it('登记过的样式写成类，白名单外的脏值回退标准细线', () => {
    expect(cardChromeClasses({ borderStyle: 'dashed' })).toEqual([
      'dt-corners',
      'dt-card-border--dashed',
    ])
    expect(cardChromeClasses({ borderStyle: 'wobble' })).toEqual([
      'dt-corners',
      'dt-card-border--solid',
    ])
  })

  it('无边框档不写边框类，那一档是整个卡片框退场', () => {
    expect(cardChromeClasses({ borderStyle: 'none' })).toEqual(['dt-corners'])
    expect(isChromeFrameless({ borderStyle: 'none' })).toBe(true)
    expect(isChromeFrameless({})).toBe(false)
  })

  it('角标形状与悬停辉光走类，取值不对就不写', () => {
    expect(cardChromeClasses({ cornerStyle: 'dot', hoverGlow: true })).toEqual([
      'dt-corners',
      'dt-corners--dot',
      'dt-module--hover-glow',
    ])
    expect(cardChromeClasses({ cornerStyle: 'bracket', hoverGlow: 1 })).toEqual(
      ['dt-corners', 'dt-corners--bracket'],
    )
  })

  // 缺省档（方形辉光）是基类自己的画法：给它造一个显式值就等于多挂一个空转的类
  it('缺省档与白名单外的脏值都不挂角标修饰类', () => {
    expect(cardChromeClasses({ cornerStyle: 'halo' })).toEqual(['dt-corners'])
    expect(cardChromeClasses({ cornerStyle: 7 })).toEqual(['dt-corners'])
  })

  it('边框样式选项表与归一化白名单同源', () => {
    for (const option of CARD_BORDER_STYLE_OPTIONS) {
      expect(normalizeCardBorderStyle(option.value)).toBe(option.value)
    }
    expect(normalizeCardBorderStyle(undefined)).toBe('solid')
    expect(normalizeCardBorderStyle(7)).toBe('solid')
  })
})

describe('两级合并', () => {
  it('模块级同键盖大屏级，不同键各自保留', () => {
    expect(mergeCardChrome({ radius: 4, bg: 'a' }, { radius: 12 })).toEqual({
      radius: 12,
      bg: 'a',
    })
  })

  it('非对象的脏值当空袋子，不炸也不吞掉另一级', () => {
    expect(mergeCardChrome(null, { radius: 4 })).toEqual({ radius: 4 })
    expect(mergeCardChrome([1], 'x')).toEqual({})
  })
})

describe('整格结论', () => {
  it('没配任何键时 style 是 undefined，一个变量都不注入', () => {
    expect(resolveCardChrome(null, null, true)).toEqual({
      isFramed: true,
      style: undefined,
      classes: ['dt-corners'],
      overlay: [],
    })
  })

  it('裸渲染模块不套框也不贴修饰类，变量照常算给模块自己用', () => {
    const bare = resolveCardChrome({ hoverGlow: true, radius: 4 }, null, false)
    expect(bare.isFramed).toBe(false)
    expect(bare.classes).toEqual([])
    expect(bare.style).toEqual({ '--card-radius': '4px' })
  })

  // ⚠ 只有显式配了样式才画：默认给一圈实线的话，存量大屏里每个裸模块都会凭空长出边框
  it('裸模块没配边框样式就不画描边浮层', () => {
    expect(resolveCardChrome({ radius: 4 }, null, false).overlay).toEqual([])
    expect(
      resolveCardChrome({ borderStyle: 'none' }, null, false).overlay,
    ).toEqual([])
  })

  it('裸模块配了边框样式就挂一层描边浮层，四角跟着来', () => {
    expect(
      resolveCardChrome({ borderStyle: 'glow' }, null, false).overlay,
    ).toEqual(['dt-module__border', 'dt-card-border--glow', 'dt-corners'])
    expect(
      resolveCardChrome(
        { borderStyle: 'glow', cornerStyle: 'dot' },
        null,
        false,
      ).overlay,
    ).toEqual([
      'dt-module__border',
      'dt-card-border--glow',
      'dt-corners',
      'dt-corners--dot',
    ])
  })

  it('清单退出统一外观的模块两条路都不走', () => {
    const off = resolveCardChrome({ borderStyle: 'glow' }, null, false, false)
    expect(off.overlay).toEqual([])
    expect(resolveCardChrome({}, null, true, false).isFramed).toBe(false)
  })

  it('无边框档去掉卡片框', () => {
    expect(
      resolveCardChrome({ borderStyle: 'none' }, null, true).isFramed,
    ).toBe(false)
  })
})
