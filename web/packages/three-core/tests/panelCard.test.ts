/**
 * @fileoverview 信息牌卡片守这几样：页眉页脚按文案有无出现、八种画法各建各的 DOM、
 * 阈值档落成行上的 `data-tone`、量程占比落成 `--tp-fill`、走势攒序列、
 * 装饰各占一个节点、引线与锚点只在非居中时出现。
 *
 * ⚠ 观感不许内联：border / background / padding 一旦被内联写死，八种变体会全部
 * 长成一个样，而配置里明明各选各的。
 * ⚠ 三层装饰挤在伪元素上时，「战术 HUD + 四角括号」这类组合会互相覆盖——
 * 后写的那条选择器赢，另一件装饰安静地不见了。
 */
import type {
  TwinPanel,
  TwinPanelField,
  TwinPanelValues,
} from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { buildPanelCard, paintPanelField } from '../src/panelCard'
import { SERIES_LENGTH } from '../src/panelChart'

const VISIBLE = {
  visible: true,
  hideBelow: null,
  hideAbove: null,
  fade: null,
} as const

const STYLE = {
  variant: 'card',
  orient: 'center',
  accent: '--accent-primary',
  background: '',
  width: 0,
  height: 0,
  columns: 1,
  density: 'normal',
  scan: false,
  corners: false,
  grid: false,
  fontScale: 1,
  scale: 1,
  animate: false,
  pulse: false,
} as const

function field(overrides: Partial<TwinPanelField> = {}): TwinPanelField {
  return {
    key: 'f1',
    label: '温度',
    unit: '',
    prefix: '',
    decimals: null,
    staticText: '',
    kind: 'text',
    min: 0,
    max: 100,
    levels: [],
    ...overrides,
  }
}

function panel(overrides: Partial<TwinPanel> = {}): TwinPanel {
  return {
    id: 'p1',
    name: '',
    subtitle: '',
    footnote: '',
    anchorId: '',
    position: [0, 0, 0],
    offset: [0, 0, 0],
    fields: [field()],
    billboard: 'face',
    style: { ...STYLE },
    visibility: { ...VISIBLE },
    ...overrides,
  }
}

/** 建一张牌，并按给定的实时值刷一遍。 */
function render(over: Partial<TwinPanel> = {}, values: TwinPanelValues = {}) {
  const built = buildPanelCard(panel(over))
  for (const view of built.fields) paintPanelField(view, values)
  return built
}

describe('页眉与页脚', () => {
  it('标题与副标题都空时不画页眉', () => {
    expect(render().card.querySelector('.twin-panel__head')).toBeNull()
  })

  it('只有副标题也画页眉', () => {
    const { card } = render({ subtitle: 'SECTOR 04' })

    expect(card.querySelector('.twin-panel__eyebrow')?.textContent).toBe(
      'SECTOR 04',
    )
    expect(card.querySelector('.twin-panel__title')).toBeNull()
  })

  it('页脚文案空时不画底栏', () => {
    expect(render().card.querySelector('.twin-panel__foot')).toBeNull()
    expect(
      render({ footnote: 'OPC-UA / NODE-042' }).card.querySelector(
        '.twin-panel__note',
      )?.textContent,
    ).toBe('OPC-UA / NODE-042')
  })

  // ⚠ 副标题与页脚都是用户可控文本，拼进 innerHTML 就是一个注入点
  it('副标题与页脚里的尖括号是文本，不是标记', () => {
    const { card } = render({
      subtitle: '<img src=x onerror=alert(1)>',
      footnote: '<script>alert(2)</script>',
    })

    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('script')).toBeNull()
    expect(card.textContent).toContain('<img')
  })
})

describe('八种画法', () => {
  it('画法落成行上的 data-kind', () => {
    for (const kind of [
      'text',
      'hero',
      'bar',
      'gauge',
      'sparkline',
      'bars',
      'dot',
      'delta',
    ] as const) {
      const { card } = render({ fields: [field({ kind })] })
      const row = card.querySelector<HTMLElement>('.twin-panel__row')
      expect(row?.dataset.kind).toBe(kind)
    }
  })

  it('进度条建一条槽，仪表建一个圆环', () => {
    expect(
      render({ fields: [field({ kind: 'bar' })] }).card.querySelector(
        '.twin-panel__track',
      ),
    ).not.toBeNull()
    expect(
      render({ fields: [field({ kind: 'gauge' })] }).card.querySelector(
        '.twin-panel__ring',
      ),
    ).not.toBeNull()
  })

  it('趋势线建一张 svg，柱群建满一排柱子', () => {
    const spark = render({ fields: [field({ kind: 'sparkline' })] })
    expect(spark.card.querySelector('.twin-panel__spark')).not.toBeNull()

    const bars = render({ fields: [field({ kind: 'bars' })] })
    expect(bars.card.querySelectorAll('.twin-panel__bars > i')).toHaveLength(
      SERIES_LENGTH,
    )
  })

  it('状态灯有灯，升降档有角标', () => {
    expect(
      render({ fields: [field({ kind: 'dot' })] }).card.querySelector(
        '.twin-panel__dot',
      ),
    ).not.toBeNull()
    expect(
      render({ fields: [field({ kind: 'delta' })] }).card.querySelector(
        '.twin-panel__delta',
      ),
    ).not.toBeNull()
  })

  // ⚠ 大字与仪表把单位单独成节点，前缀提到标签里；沿用整串会让大字里混着单位
  it('大字档数值与单位分开，前缀提进标签', () => {
    const { card } = render(
      { fields: [field({ kind: 'hero', prefix: '出口', unit: '℃' })] },
      { 'p1::f1': { value: 25.4 } },
    )

    expect(card.querySelector('.twin-panel__num')?.textContent).toBe('25.4')
    expect(card.querySelector('.twin-panel__unit')?.textContent).toBe('℃')
    expect(card.querySelector('.twin-panel__label')?.textContent).toBe(
      '出口 温度',
    )
  })

  it('文本档仍是前缀数值单位拼成的一串', () => {
    const { card } = render(
      { fields: [field({ prefix: '出口', unit: '℃', decimals: 1 })] },
      { 'p1::f1': { value: 25.46 } },
    )

    expect(card.querySelector('.twin-panel__value')?.textContent).toBe(
      '出口 25.5 ℃',
    )
  })
})

describe('阈值档与量程', () => {
  it('命中的档落成行上的 data-tone', () => {
    const built = render(
      {
        fields: [
          field({
            kind: 'bar',
            levels: [
              { id: 'l1', at: 60, tone: 'warning' },
              { id: 'l2', at: 80, tone: 'danger' },
            ],
          }),
        ],
      },
      { 'p1::f1': { value: 90 } },
    )

    const row = built.card.querySelector<HTMLElement>('.twin-panel__row')
    expect(row?.dataset.tone).toBe('danger')
  })

  it('没命中任何一档时不留 data-tone', () => {
    const built = render(
      { fields: [field({ levels: [{ id: 'l1', at: 60, tone: 'danger' }] })] },
      { 'p1::f1': { value: 10 } },
    )

    const row = built.card.querySelector<HTMLElement>('.twin-panel__row')
    expect(row?.dataset.tone).toBeUndefined()
  })

  it('量程占比落成行上的 --tp-fill', () => {
    const built = render(
      { fields: [field({ kind: 'bar', min: 0, max: 200 })] },
      { 'p1::f1': { value: 50 } },
    )
    const row = built.card.querySelector<HTMLElement>('.twin-panel__row')

    expect(row?.style.getPropertyValue('--tp-fill')).toBe('0.250')
  })

  // ⚠ 上限不大于下限时留着上一轮的占比，进度条会停在一个骗人的位置
  it('量程画不出来时把占比摘掉，不留残值', () => {
    const built = buildPanelCard(
      panel({ fields: [field({ kind: 'bar', min: 0, max: 100 })] }),
    )
    const view = built.fields[0]
    if (view === undefined) throw new Error('本该建出一行')

    paintPanelField(view, { 'p1::f1': { value: 50 } })
    paintPanelField(view, { 'p1::f1': { value: Number.NaN } })

    expect(view.row.style.getPropertyValue('--tp-fill')).toBe('')
  })
})

describe('走势序列', () => {
  it('每收一个读数攒一个点，超过上限只留最近的', () => {
    const built = buildPanelCard(
      panel({ fields: [field({ kind: 'sparkline' })] }),
    )
    const view = built.fields[0]
    if (view === undefined) throw new Error('本该建出一行')

    for (let step = 0; step < SERIES_LENGTH + 8; step += 1) {
      paintPanelField(view, { 'p1::f1': { value: step } })
    }

    const drawn = built.card
      .querySelector('.twin-panel__spark-line')
      ?.getAttribute('points')
    expect(drawn?.split(' ')).toHaveLength(SERIES_LENGTH)
  })

  // ⚠ 一个点画不出线，留半截线头看着像数据错了
  it('只有一个点时不画线', () => {
    const built = render(
      { fields: [field({ kind: 'sparkline' })] },
      { 'p1::f1': { value: 5 } },
    )

    expect(
      built.card
        .querySelector('.twin-panel__spark-line')
        ?.getAttribute('points'),
    ).toBe('')
  })

  it('取不到读数的那一轮不占位', () => {
    const built = buildPanelCard(panel({ fields: [field({ kind: 'bars' })] }))
    const view = built.fields[0]
    if (view === undefined) throw new Error('本该建出一行')

    paintPanelField(view, {})
    paintPanelField(view, { 'p1::f1': { value: Number.NaN } })

    const filled = [...built.card.querySelectorAll('.twin-panel__bars > i')]
      .filter((bar) => bar instanceof HTMLElement)
      .filter((bar) => bar.style.getPropertyValue('--tp-bar') !== '0.000')
    expect(filled).toHaveLength(0)
  })

  // ⚠ 别的画法也攒序列的话，几十张牌各挂一个白攒的数组
  it('不吃序列的画法不建迷你图', () => {
    const built = buildPanelCard(panel({ fields: [field({ kind: 'bar' })] }))

    expect(built.fields[0]?.chart).toBeNull()
  })
})

describe('升降角标', () => {
  it('比上一次高是升，低是降', () => {
    const built = buildPanelCard(panel({ fields: [field({ kind: 'delta' })] }))
    const view = built.fields[0]
    if (view === undefined) throw new Error('本该建出一行')

    paintPanelField(view, { 'p1::f1': { value: 10 } })
    paintPanelField(view, { 'p1::f1': { value: 20 } })
    expect(view.deltaEl?.dataset.dir).toBe('up')

    paintPanelField(view, { 'p1::f1': { value: 5 } })
    expect(view.deltaEl?.dataset.dir).toBe('down')
  })

  // ⚠ 第一个读数没有可比的上一次，画成升或降都是编出来的
  it('第一个读数不判升降', () => {
    const built = render(
      { fields: [field({ kind: 'delta' })] },
      { 'p1::f1': { value: 10 } },
    )

    const mark = built.card.querySelector<HTMLElement>('.twin-panel__delta')
    expect(mark?.dataset.dir).toBe('flat')
  })
})

describe('还没有读数时', () => {
  // ⚠ 图形只画填充不画骨架时，没读数的仪表只剩一个数字、进度条与趋势线整个不见，
  //   用户看到的是「这几档画法没生效」，而配置里明明选着
  it('没有读数的行落一个 data-empty，样式表拿它显骨架', () => {
    const built = render({ fields: [field({ kind: 'gauge' })] })
    const row = built.card.querySelector<HTMLElement>('.twin-panel__row')

    expect(row?.dataset.empty).toBe('on')
  })

  it('读数一到就把这个标记摘掉', () => {
    const built = buildPanelCard(panel({ fields: [field({ kind: 'gauge' })] }))
    const view = built.fields[0]
    if (view === undefined) throw new Error('本该建出一行')

    paintPanelField(view, {})
    expect(view.row.dataset.empty).toBe('on')

    paintPanelField(view, { 'p1::f1': { value: 40 } })
    expect(view.row.dataset.empty).toBeUndefined()
  })

  it('趋势线在没有读数时也留着盒子，不是一片空白', () => {
    const built = render({ fields: [field({ kind: 'sparkline' })] })
    const box = built.card.querySelector<HTMLElement>('.twin-panel__spark-box')

    expect(box).not.toBeNull()
    expect(box?.dataset.empty).toBe('on')
  })

  it('柱群在没有读数时标成空槽，与「读数为零」区分开', () => {
    const built = buildPanelCard(panel({ fields: [field({ kind: 'bars' })] }))
    const view = built.fields[0]
    if (view === undefined) throw new Error('本该建出一行')
    const bars = built.card.querySelector<HTMLElement>('.twin-panel__bars')

    paintPanelField(view, {})
    expect(bars?.dataset.empty).toBe('on')

    paintPanelField(view, { 'p1::f1': { value: 0 } })
    expect(bars?.dataset.empty).toBe('off')
  })
})

describe('版式与装饰', () => {
  it('密度与列数落成卡片属性', () => {
    const { card } = render({
      style: { ...STYLE, density: 'loose', columns: 3 },
    })

    expect(card.dataset.density).toBe('loose')
    expect(card.dataset.columns).toBe('3')
  })

  // ⚠ `clip-path` 连后代一起裁：切角画在卡片上会把四角括号与横扫光带一起切掉，
  //   而配置里明明开着。切角只许画在外壳层上。
  it('每张卡片都有一层外壳，底与切角画在它身上', () => {
    const { card } = render({ style: { ...STYLE, variant: 'precision' } })

    expect(card.querySelector('.twin-panel__shell')).not.toBeNull()
    expect(card.style.clipPath).toBe('')
  })

  it('三层装饰各出一个节点，开哪个出哪个', () => {
    const none = render()
    expect(none.card.querySelector('.twin-panel__scan')).toBeNull()
    expect(none.card.querySelector('.twin-panel__corners')).toBeNull()
    expect(none.card.querySelector('.twin-panel__grid')).toBeNull()

    const all = render({
      style: { ...STYLE, scan: true, corners: true, grid: true },
    })
    expect(all.card.querySelector('.twin-panel__scan')).not.toBeNull()
    expect(all.card.querySelector('.twin-panel__corners')).not.toBeNull()
    expect(all.card.querySelector('.twin-panel__grid')).not.toBeNull()
  })

  // ⚠ 两件装饰共用一个伪元素时，后写的那条选择器赢，另一件安静地不见了
  it('战术 HUD 配上四角括号时两件装饰同时在', () => {
    const { card } = render({
      style: { ...STYLE, variant: 'hud', corners: true },
    })

    expect(card.classList.contains('twin-panel--hud')).toBe(true)
    expect(card.querySelector('.twin-panel__corners')).not.toBeNull()
  })
})

describe('引线与锚点', () => {
  it('居中档不画引线，也不画锚点标记', () => {
    const { mount } = render()

    expect(mount.querySelector('.twin-panel-lead')).toBeNull()
    expect(mount.querySelector('.twin-panel-anchor')).toBeNull()
  })

  it('非居中档画引线与锚点标记，方向落成挂点属性', () => {
    const { mount } = render({ style: { ...STYLE, orient: 'top' } })

    expect(mount.dataset.orient).toBe('top')
    expect(mount.querySelector('.twin-panel-lead')).not.toBeNull()
    expect(mount.querySelector('.twin-panel-anchor')).not.toBeNull()
  })
})

describe('取不到数时', () => {
  // ⚠ 按拼完前缀单位的整串判「有没有值」，会让配了前缀的字段收到 NaN 时
  //   只显示前缀两个字：既不退回静态文案，也看不出是取不到数
  it('配了前缀的字段收到非有限数时仍退回静态文案', () => {
    const { card } = render(
      { fields: [field({ prefix: '出口', unit: '℃', staticText: '待接入' })] },
      { 'p1::f1': { value: Number.NaN } },
    )

    expect(card.querySelector('.twin-panel__value')?.textContent).toBe(
      '出口 待接入 ℃',
    )
  })

  it('两样都没有时说取不到，不留一块空白', () => {
    const { card } = render()

    expect(card.querySelector('.twin-panel__value')?.textContent).toBe('—')
  })
})
