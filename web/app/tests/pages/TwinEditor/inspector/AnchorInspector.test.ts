/**
 * @fileoverview 契约：锚点检查器能表达「不定小数位」这一档。
 *
 * ⚠ `decimals = null` 与 `decimals = 0` 不是一回事：前者按原值上屏，后者会把
 * 0.4 显示成 0。让 0 兼职表示「不定」的话，界面上这两档看起来一模一样。
 * 另锁住：位置能从视口拾取、改任何一项都整份写回。
 */
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinAnchor } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnchorInspector from '@/pages/TwinEditor/components/inspector/AnchorInspector.vue'
import type { TwinFrameView } from '@/pages/TwinEditor/scripts/coordFrame'

/** 基准原点落在世界原点上：这一份用例守的不是坐标基准，读数即世界坐标。 */
const FRAME: TwinFrameView = { mode: 'model', origin: [0, 0, 0] }

function makeAnchor(over: Record<string, unknown> = {}): TwinAnchor {
  const anchor = normalizeTwinConfig({
    anchors: [{ id: 'a1', name: '进水温度', ...over }],
  }).anchors[0]
  if (anchor === undefined) throw new Error('造不出锚点')
  return anchor
}

function mountAnchor(
  modelValue: TwinAnchor = makeAnchor(),
  picking = false,
  frame: TwinFrameView = FRAME,
) {
  return mount(AnchorInspector, { props: { modelValue, frame, picking } })
}

type Wrapper = ReturnType<typeof mountAnchor>

function lastAnchor(wrapper: Wrapper): TwinAnchor {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回锚点')
  return events[events.length - 1]?.[0] as TwinAnchor
}

function buttonByText(wrapper: Wrapper, text: string) {
  const found = wrapper.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

/** 小数位框排在坐标那三个之后。 */
function decimalsInput(wrapper: Wrapper) {
  const found = wrapper.findAll('input[role="spinbutton"]')[3]
  if (!found) throw new Error('没有小数位输入框')
  return found
}

/** 纯文本框按文档序：名字 / 前缀 / 单位。 */
function textInput(wrapper: Wrapper, index: number) {
  const found = wrapper.findAll('input[type="text"]:not([role])')[index]
  if (!found) throw new Error(`没有第 ${index} 个文本框`)
  return found
}

describe('小数位', () => {
  it('不定位数时说清楚它按原值上屏，不是「定 0 位」', () => {
    const wrapper = mountAnchor()

    expect(wrapper.text()).toContain('不定位数')
    // 只剩坐标那三个数字框，没有小数位那一个
    expect(wrapper.findAll('input[role="spinbutton"]')).toHaveLength(3)
  })

  it('打开固定小数位给的是一个具体位数，不是 null', async () => {
    const wrapper = mountAnchor()

    await buttonByText(wrapper, '固定小数位').trigger('click')

    expect(lastAnchor(wrapper).decimals).toBe(1)
  })

  it('关掉固定小数位回到 null，而不是落一个 0', async () => {
    const wrapper = mountAnchor(makeAnchor({ decimals: 2 }))

    await buttonByText(wrapper, '固定小数位').trigger('click')

    expect(lastAnchor(wrapper).decimals).toBeNull()
  })

  it('定了位数才露出位数输入框', () => {
    const wrapper = mountAnchor(makeAnchor({ decimals: 2 }))

    expect(wrapper.text()).not.toContain('不定位数')
    expect(wrapper.findAll('input[role="spinbutton"]')).toHaveLength(4)
  })

  it('位数改成 0 是「定 0 位」，不许被当成没配', async () => {
    const wrapper = mountAnchor(makeAnchor({ decimals: 2 }))

    // ⚠ setValue 就已经落定了；再补一次 change 会拿被 settle 回滚的显示值再提交一遍
    await decimalsInput(wrapper).setValue('0')

    expect(lastAnchor(wrapper).decimals).toBe(0)
  })
})

describe('位置', () => {
  // ⚠ 基准没接上时这三个数仍是世界坐标，而画面上一点异常都看不出——只能靠这条守
  it('坐标按当前基准显示，并把基准原点写在下面', () => {
    const wrapper = mountAnchor(makeAnchor({ position: [12, 4, -25] }), false, {
      mode: 'center',
      origin: [10, 0, -30],
    })

    const shown = ['X', 'Y', 'Z'].map((axis) => {
      const found = wrapper.find(`input[aria-label="${axis}"]`)
      return (found.element as HTMLInputElement).value
    })

    expect(shown).toEqual(['2', '4', '5'])
    expect(wrapper.text()).toContain('0 在模型中心')
    expect(wrapper.text()).toContain('10 / 0 / -30')
  })

  it('基准原点就在世界原点上时不多那行提示', () => {
    const wrapper = mountAnchor()

    expect(wrapper.text()).not.toContain('0 在模型')
  })

  it('点一下请求从视口拾取', async () => {
    const wrapper = mountAnchor()

    await buttonByText(wrapper, '从视口拾取位置').trigger('click')

    expect(wrapper.emitted('requestPickPosition')).toHaveLength(1)
  })

  it('拾取中再点是取消', async () => {
    const wrapper = mountAnchor(makeAnchor(), true)

    await buttonByText(wrapper, '点模型表面放置…（取消）').trigger('click')

    expect(wrapper.emitted('cancelPick')).toHaveLength(1)
    expect(wrapper.emitted('requestPickPosition')).toBeUndefined()
  })

  it('改一个分量也整份换新数组', async () => {
    const anchor = makeAnchor({ position: [1, 2, 3] })
    const wrapper = mountAnchor(anchor)

    await wrapper.find('input[aria-label="X"]').setValue('9')

    expect(lastAnchor(wrapper).position).toEqual([9, 2, 3])
    expect(anchor.position).toEqual([1, 2, 3])
  })
})

describe('读数', () => {
  it('前缀留空时说明只显示数值', () => {
    const wrapper = mountAnchor()

    expect(wrapper.text()).toContain('留空 = 只显示数值')
  })

  it('改单位回的是整份锚点，其余字段原样带上', async () => {
    const anchor = makeAnchor({ label: '进水', decimals: 2 })
    const wrapper = mountAnchor(anchor)

    await textInput(wrapper, 2).setValue('℃')

    const next = lastAnchor(wrapper)
    expect(next.unit).toBe('℃')
    expect(next.label).toBe('进水')
    expect(next.decimals).toBe(2)
    expect(anchor.unit).toBe('')
  })
})

describe('显隐', () => {
  it('用共用的显隐件', () => {
    const wrapper = mountAnchor()

    expect(wrapper.text()).toContain('初始可见')
    expect(wrapper.text()).toContain('距离规则只在大屏运行时生效')
  })
})
