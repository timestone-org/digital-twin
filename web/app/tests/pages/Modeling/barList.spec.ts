/**
 * @fileoverview 横条画出来的样子：名称走 DtTooltip 出全名、读数与截断都是可见
 * 文字、图例逐档带字，以及「颜色不作唯一编码」那几档的第二重编码真在样式里。
 *
 * ⚠ 斜纹与描边只活在 scoped SCSS 里，happy-dom 不套用样式，挂载断言看不见它们；
 * 少了这一重编码，图在色觉障碍与灰度打印下就只剩一排一样的条（规格 §2-P6）。
 */
import { DtTooltip } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import BarList from '@/pages/Modeling/Canvas/components/BarList.vue'
import type { BarListItem } from '@/pages/Modeling/Canvas/scripts/barList'

const LONG_NAME = '1#冷冻水泵出口温度与回水温度的差值折算后的读数'

// ⚠ 斜纹、描边与省略号只活在 scoped SCSS 里，happy-dom 不套用样式
const SOURCE = readFileSync(
  join(process.cwd(), 'app/src/pages/Modeling/Canvas/components/BarList.vue'),
  'utf8',
)

function styles(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('.dt-ml-bars__piece')
    .map((piece) => piece.attributes('style') ?? '')
}

describe('横条的可见文字', () => {
  it('一项都没有时给一句空态，不是一片空白', () => {
    const wrapper = mount(BarList, {
      props: { items: [], emptyText: '这一步没有列可以排' },
    })

    expect(wrapper.text()).toContain('这一步没有列可以排')
    expect(wrapper.findAll('.dt-ml-bars__row')).toHaveLength(0)
  })

  it('名称与读数都是页面上的文字', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: '温度', value: 3 }], unit: '℃' },
    })

    expect(wrapper.text()).toContain('温度')
    expect(wrapper.text()).toContain('3 ℃')
  })

  it('长名字截断靠版式，全名挂在 DtTooltip 上', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: LONG_NAME, value: 1 }] },
    })

    expect(wrapper.findComponent(DtTooltip).props('content')).toBe(LONG_NAME)
    expect(wrapper.find('.dt-ml-bars__name').text()).toBe(LONG_NAME)
  })

  it('截了多少项写在图下，不是默默少几行', () => {
    const many: BarListItem[] = Array.from({ length: 70 }, (_, seat) => ({
      name: `c${seat}`,
      value: seat + 1,
    }))
    const wrapper = mount(BarList, { props: { items: many } })

    expect(wrapper.text()).toContain('只画了前 60 项')
    expect(wrapper.text()).toContain('另有 10 项没画')
  })

  it('没截断时不摆那句话', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: 'a', value: 1 }] },
    })

    expect(wrapper.find('.dt-ml-bars__more').exists()).toBe(false)
  })

  it('结论那行字是可见文字，调用方给什么写什么', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: 'a', value: 1 }], caption: '只有两列在起作用' },
    })

    expect(wrapper.find('.dt-ml-bars__caption').text()).toBe('只有两列在起作用')
  })

  it('结论也能用插槽给', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: 'a', value: 1 }] },
      slots: { caption: '丢了 33.2% 的行' },
    })

    expect(wrapper.find('.dt-ml-bars__caption').text()).toBe('丢了 33.2% 的行')
  })

  it('两样都没给就不摆那一行', () => {
    const wrapper = mount(BarList, {
      props: { items: [{ name: 'a', value: 1 }] },
    })

    expect(wrapper.find('.dt-ml-bars__caption').exists()).toBe(false)
  })
})

describe('条子的几何落到 style 上', () => {
  it('全零时宽度是 0%，不是除出来的 NaN', () => {
    const wrapper = mount(BarList, {
      props: {
        items: [
          { name: 'a', value: 0 },
          { name: 'b', value: 0 },
        ],
      },
    })

    expect(styles(wrapper)).toEqual([
      'left: 0%; width: 0%;',
      'left: 0%; width: 0%;',
    ])
  })

  it('前后对比的两根条各占一条带', () => {
    const wrapper = mount(BarList, {
      props: {
        mode: 'pairs',
        items: [{ name: '空值率', before: 0.5, after: 0.25 }],
      },
    })

    expect(wrapper.findAll('.dt-ml-bars__piece--top')).toHaveLength(1)
    expect(wrapper.findAll('.dt-ml-bars__piece--bottom')).toHaveLength(1)
    expect(wrapper.findAll('.dt-ml-bars__piece--before')).toHaveLength(1)
  })

  it('参考线与阈值线画在每一条轨道里', () => {
    const wrapper = mount(BarList, {
      props: {
        items: [
          { name: 'a', value: 1 },
          { name: 'b', value: 2 },
        ],
        threshold: { value: 3, label: '阈值 θ=3' },
      },
    })

    expect(wrapper.findAll('.dt-ml-bars__rule--threshold')).toHaveLength(2)
    expect(wrapper.text()).toContain('阈值 θ=3')
  })
})

// ⚠ 名字搁在左上角图例里的话，读者得横跨大半张图才能把字与线对上
describe('竖线的名字站在线的正上方', () => {
  function bars(props: Record<string, unknown>): ReturnType<typeof mount> {
    return mount(BarList, {
      props: { items: [{ name: 'a', value: 0.42 }], ...props },
    })
  }

  it('名字与线落在同一个百分数上，且只写一遍', () => {
    const wrapper = bars({ threshold: { value: 0.21, label: '入选线 0.21' } })
    const mark = wrapper.find('.dt-ml-bars__mark')

    expect(mark.attributes('style')).toBe('left: 50%;')
    expect(wrapper.find('.dt-ml-bars__rule').attributes('style')).toBe(
      'left: 50%;',
    )
    expect(mark.text()).toBe('入选线 0.21')
    expect(wrapper.findAll('.dt-ml-bars__keys li')).toHaveLength(0)
  })

  it('挨得近的两条错开一行，那一栏跟着长高', () => {
    const wrapper = bars({
      reference: { value: 0.12, label: '平均分 0.12' },
      threshold: { value: 0.1, label: '入选线 0.1' },
    })

    expect(wrapper.find('.dt-ml-bars__ruler--tall').exists()).toBe(true)
    expect(wrapper.findAll('.dt-ml-bars__mark--row1')).toHaveLength(1)
  })

  it('离得远的两条不错行，那一栏也不加高', () => {
    const wrapper = bars({
      reference: { value: 0.1, label: '均值' },
      threshold: { value: 0.35, label: '阈值' },
    })

    expect(wrapper.find('.dt-ml-bars__ruler--tall').exists()).toBe(false)
    expect(wrapper.findAll('.dt-ml-bars__mark--row0')).toHaveLength(2)
  })

  it('一条线都没配时不摆这一栏', () => {
    expect(bars({}).find('.dt-ml-bars__ruler').exists()).toBe(false)
  })

  // ⚠ 错开的那一行离轨道有一行的距离，没有引线就认不出它归哪条线
  it('错行的名字有一条引线接回轨道', () => {
    expect(SOURCE).toMatch(/&__mark \{[\s\S]{0,400}&::after \{/)
    expect(SOURCE).toMatch(/&__mark--row1::after \{[\s\S]{0,120}height: 1.3rem/)
  })
})

describe('颜色不作唯一编码', () => {
  it('图例逐档都带一行字，不是光给一块色', () => {
    const wrapper = mount(BarList, {
      props: {
        mode: 'stacked',
        items: [
          {
            name: '对齐',
            segments: [
              { label: '两边都有', value: 10 },
              { label: '左有右无', value: 5 },
            ],
          },
        ],
      },
    })

    const keys = wrapper.findAll('.dt-ml-bars__keys li')
    expect(keys.map((one) => one.text())).toEqual(['两边都有', '左有右无'])
    expect(wrapper.findAll('.dt-ml-bars__piece--dropped')).toHaveLength(1)
  })

  it('丢弃档除了警示色还有斜纹', () => {
    expect(SOURCE).toMatch(/--dropped[\s\S]{0,240}repeating-linear-gradient/)
  })

  it('越界档除了危险色还有一圈边框', () => {
    expect(SOURCE).toMatch(/--danger[\s\S]{0,120}border: 1px solid/)
  })

  it('「之前」是空心描边、不给填充', () => {
    expect(SOURCE).toMatch(/--before[\s\S]{0,120}border: 1px dashed/)
  })
})

describe('长名字的截断口径', () => {
  // ⚠ 三列由整张表定宽而不是每行各自收缩：名字与读数逐行长短不一时，
  // 逐行收缩会让每行的轨道起止差出几十像素，条长就没法横着比
  it('名称列 12rem 封顶，且三列由整张表定宽', () => {
    expect(SOURCE).toMatch(
      /grid-template-columns: fit-content\(12rem\) minmax\(0, 1fr\) max-content/,
    )
  })

  // ⚠ 省略号挂在 DtTooltip 根上不生效：那层是 inline-flex，文字是匿名弹性项
  it('省略号落在文字那一层，不是挂在 DtTooltip 根上', () => {
    expect(SOURCE).toMatch(/&__label \{[\s\S]{0,200}text-overflow: ellipsis/)
  })
})
