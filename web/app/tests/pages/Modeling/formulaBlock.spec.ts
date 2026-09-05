/**
 * @fileoverview 公式排版件：两态切换、递归画分式 / 根号 / Σ / 分档式、
 * 折行只断在运算符前，以及复制出去的必须是纯 ASCII 而不是屏幕上那串符号。
 */
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import FormulaBlock from '@/pages/Modeling/Canvas/components/FormulaBlock.vue'
import {
  cases,
  frac,
  nameOf,
  numOf,
  opOf,
  run,
  sqrt,
  sum,
  varOf,
} from '@/pages/Modeling/Canvas/scripts/formula'
import type { FormulaSpec } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'
import { copyText } from '@/utils/clipboard'

vi.mock('@/utils/clipboard', () => ({ copyText: vi.fn() }))

const copied = vi.mocked(copyText)

// ⚠ 排版是 CSS 排的，而 happy-dom 不排版、量不出真实宽度：分式与根号那两条
// 「对得齐」只能从样式正文上钉。vitest 的 cwd 就是 web/
const STYLE = readFileSync(
  `${process.cwd()}/app/src/pages/Modeling/Canvas/components/FormulaBlock.vue`,
  'utf8',
)

/** 取 `&__x { … }` 这一条规则的正文（含它自己的嵌套规则）。 */
function ruleOf(name: string): string {
  return new RegExp(`&${name} \\{([\\s\\S]*?)\\n  \\}`).exec(STYLE)?.[1] ?? ''
}

function spec(patch: Partial<FormulaSpec> = {}): FormulaSpec {
  return {
    id: 'predict',
    title: '预测值',
    symbolic: [
      run(nameOf('ŷ'), opOf('='), varOf('β₀'), opOf('+')),
      sum('j = 1', 'p', [run(varOf('βⱼ'), opOf('·'), varOf('xⱼ'))]),
    ],
    filled: [
      run(
        nameOf('ŷ'),
        opOf('='),
        numOf(1403.2),
        opOf('+'),
        numOf(3.21),
        opOf('·'),
        varOf('温度'),
      ),
    ],
    fallback: null,
    isOpen: false,
    legend: [{ symbol: 'β₀', text: '截距' }],
    notes: ['系数跟着量纲走。'],
    ...patch,
  }
}

beforeEach(() => {
  copied.mockReset()
  copied.mockResolvedValue(true)
})

describe('两态', () => {
  it('折叠时是符号态', () => {
    const wrapper = mount(FormulaBlock, { props: { spec: spec() } })

    expect(wrapper.text()).toContain('β₀')
    expect(wrapper.text()).not.toContain('1403.2')
  })

  it('默认展开的那几条一上来就是代入态', () => {
    const wrapper = mount(FormulaBlock, {
      props: { spec: spec({ isOpen: true }) },
    })

    expect(wrapper.text()).toContain('1403.2')
  })

  it('点一下就在两态之间来回切', async () => {
    const wrapper = mount(FormulaBlock, { props: { spec: spec() } })
    const toggle = wrapper.findAll('button')[0]

    await toggle?.trigger('click')
    expect(wrapper.text()).toContain('1403.2')

    await toggle?.trigger('click')
    expect(wrapper.text()).toContain('β₀')
  })

  it('代不进实参时既没有切换键，也把原因写在脸上', () => {
    const wrapper = mount(FormulaBlock, {
      props: {
        spec: spec({ filled: null, fallback: '这个模型没有可读的系数' }),
      },
    })

    expect(wrapper.text()).toContain('这个模型没有可读的系数')
    expect(wrapper.findAll('button')).toHaveLength(1)
  })

  it('变量表与告警逐条摆出来', () => {
    const wrapper = mount(FormulaBlock, { props: { spec: spec() } })

    expect(wrapper.text()).toContain('截距')
    expect(wrapper.text()).toContain('系数跟着量纲走。')
  })
})

describe('复制', () => {
  it('复制的是纯 ASCII，不是屏幕上那串符号', async () => {
    const wrapper = mount(FormulaBlock, {
      props: { spec: spec({ isOpen: true }) },
    })

    await wrapper.find('button[aria-label="复制成纯文本"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(copied).toHaveBeenCalledWith('y = 1403.2 + 3.21*温度')
    expect(wrapper.text()).toContain('已复制')
  })

  it('复制当前那一态：符号态就复制符号态', async () => {
    const wrapper = mount(FormulaBlock, { props: { spec: spec() } })

    await wrapper.find('button[aria-label="复制成纯文本"]').trigger('click')

    expect(copied).toHaveBeenCalledWith('y = b0 + sum(j = 1..p, bj*xj)')
  })

  it('「已复制」过两秒自己退场，不赖在标题旁边', async () => {
    vi.useFakeTimers()
    const wrapper = mount(FormulaBlock, { props: { spec: spec() } })

    await wrapper.find('button[aria-label="复制成纯文本"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('已复制')

    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('已复制')
    vi.useRealTimers()
  })

  it('内网纯 HTTP 下复制不了时，改叫用户自己选中', async () => {
    copied.mockResolvedValue(false)
    const wrapper = mount(FormulaBlock, { props: { spec: spec() } })

    await wrapper.find('button[aria-label="复制成纯文本"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('复制失败')
  })
})

describe('递归排版', () => {
  it('分式的分子分母各画一半，中间夹一道横杠', () => {
    const wrapper = mount(FormulaBlock, {
      props: {
        nodes: [
          frac(
            [run(varOf('1'))],
            [run(varOf('1'), opOf('+'), varOf('exp(−z)'))],
          ),
        ],
      },
    })

    expect(wrapper.text()).toContain('exp(−z)')
    expect(wrapper.findAll('.dt-fx__part')).toHaveLength(2)
    expect(wrapper.find('.dt-fx__bar').exists()).toBe(true)
  })

  it('根号画成一笔可伸缩的描边，加一条上横线', () => {
    const wrapper = mount(FormulaBlock, {
      props: { nodes: [sqrt([run(varOf('x'))])] },
    })

    expect(wrapper.find('.dt-fx__radical').exists()).toBe(true)
    expect(wrapper.find('.dt-fx__roof').exists()).toBe(true)
  })

  it('Σ 的上下限走 sup 与 sub', () => {
    const wrapper = mount(FormulaBlock, {
      props: { nodes: [sum('j = 1', 'p', [run(varOf('βⱼ'))])] },
    })

    expect(wrapper.find('sup').text()).toBe('p')
    expect(wrapper.find('sub').text()).toBe('j = 1')
    expect(wrapper.text()).toContain('βⱼ')
  })

  it('分档式一档一行，条件挨着式子', () => {
    const wrapper = mount(FormulaBlock, {
      props: {
        nodes: [
          cases([
            { when: 'p(x) ≥ 0.5', then: [run(numOf(1))] },
            { when: 'p(x) < 0.5', then: [run(numOf(0))] },
          ]),
        ],
      },
    })

    expect(wrapper.findAll('.dt-fx__when')).toHaveLength(2)
    expect(wrapper.text()).toContain('p(x) ≥ 0.5')
  })

  it('递归下去的那几层不再重复画标题与复制键', () => {
    const wrapper = mount(FormulaBlock, {
      props: {
        spec: spec({
          symbolic: [frac([run(varOf('a'))], [run(varOf('b'))])],
          filled: null,
        }),
      },
    })

    expect(wrapper.findAll('button')).toHaveLength(1)
  })

  it('一个节点都没有时画一行空，不报错', () => {
    const wrapper = mount(FormulaBlock, { props: { nodes: [] } })

    expect(wrapper.find('.dt-fx__row').exists()).toBe(true)
  })
})

describe('二维排版对得齐', () => {
  // 分子是 Σ 加一串求和项、比分母那个 n 宽得多——横杠只有分母那么宽时，
  // 分子就整个伸到线外去了
  const MAPE = frac(
    [
      sum('i = 1', 'n', [
        run(varOf('|入口温度ᵢ'), opOf('−'), varOf('预测入口温度ᵢ|')),
      ]),
    ],
    [run(varOf('n'))],
  )

  it('横杠自成一格夹在分子分母中间，不是挂在分母上的一条边', () => {
    const wrapper = mount(FormulaBlock, { props: { nodes: [MAPE] } })
    const box = wrapper.find('.dt-fx__frac').element

    expect([...box.children].map((one) => one.getAttribute('class'))).toEqual([
      'dt-fx dt-fx__part',
      'dt-fx__bar',
      'dt-fx dt-fx__part',
    ])
    expect(wrapper.findAll('.dt-fx__part .dt-fx__bar')).toHaveLength(0)
  })

  // 分子分母同在一列、列宽取宽的那个，横杠拉满这一列 → 横杠不窄于分子
  it('横杠拉满分子分母共用的那一列，两半自己不带横线', () => {
    expect(ruleOf('__bar')).toContain('justify-self: stretch')
    expect(ruleOf('__part')).not.toContain('border-top')
  })

  // ⚠ 不缩放的 √ 字形配两行高的被开方式，会小小地挂在左下角、跟顶上那条线断开
  it('根号按被开方式的高度伸缩，描边宽度不跟着变粗', () => {
    const wrapper = mount(FormulaBlock, {
      props: { nodes: [sqrt([MAPE])] },
    })
    const radical = wrapper.find('.dt-fx__radical')

    expect(radical.attributes('preserveAspectRatio')).toBe('none')
    expect(ruleOf('__radical')).toContain('vector-effect: non-scaling-stroke')
  })

  it('根号读得出来：一笔描边也带一个可朗读的名字', () => {
    const wrapper = mount(FormulaBlock, {
      props: { nodes: [sqrt([run(varOf('x'))])] },
    })

    expect(wrapper.find('.dt-fx__radical').attributes('aria-label')).toBe(
      '根号',
    )
  })
})

describe('折行', () => {
  it('每一项各占一个不可断的 span，运算符打头', () => {
    const wrapper = mount(FormulaBlock, {
      props: { spec: spec({ isOpen: true }) },
    })
    const items = wrapper.findAll('.dt-fx__item')

    expect(items.map((item) => item.text())).toEqual([
      'ŷ',
      '=1403.2',
      '+3.21·温度',
    ])
  })

  it('数值与变量各走各的字族，靠 class 分开', () => {
    const wrapper = mount(FormulaBlock, {
      props: { spec: spec({ isOpen: true }) },
    })

    expect(wrapper.findAll('.dt-fx__t--num').length).toBeGreaterThan(0)
    expect(wrapper.findAll('.dt-fx__t--var').length).toBeGreaterThan(0)
  })
})
