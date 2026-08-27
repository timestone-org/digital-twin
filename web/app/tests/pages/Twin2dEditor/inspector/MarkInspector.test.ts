/**
 * @fileoverview 契约：标注检查器把三档 kind、几何、标签排版、描边填充与相对节点层的
 * 上下两档都摆得出来，且改动只以整份新配置往上抛、自己不碰文档态。
 *
 * ⚠ `zOrder` 两档必须给得出来：参考项目的编辑器不分层，配了 `below` 的标注在编辑器里
 * 看着在上、上了大屏跑到下面，这条按「两档都点得到且写得回」钉住。
 * ⚠ 文本与数字走合并撤销：逐帧各记一条的话，敲一行标签就把撤销栈塞满。这条按
 * 「文本框抛 merge 而不是 change」「焦点离开抛 endMerge」钉住。
 * ⚠ 这一档画不出来的控件一概不摆——辅助线没有填充、文字标注的线宽虚线被标签排版
 * 盖掉——摆一个配了没反应的控件比没有更糟。
 */
import {
  TWIN_2D_MARK_KINDS,
  TWIN_2D_MARK_Z_ORDERS,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dConfig, Twin2dMark } from '@dt/twin2d'
import { DtSegmented, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColorField from '@/pages/Twin2dEditor/components/fields/ColorField.vue'
import MarkInspector from '@/pages/Twin2dEditor/components/inspector/MarkInspector.vue'

/** 夹具走一遍归一化，字段口径与真文档逐字相同。 */
function makeConfig(seed: Record<string, unknown>): Twin2dConfig {
  return normalizeTwin2dConfig({ marks: [{ id: 'm1', ...seed }] })
}

function firstMark(config: Twin2dConfig): Twin2dMark {
  const mark = config.marks[0]
  if (mark === undefined) throw new Error('夹具里没有标注')
  return mark
}

function mountInspector(seed: Record<string, unknown>) {
  const config = makeConfig(seed)
  return mount(MarkInspector, { props: { mark: firstMark(config), config } })
}

type Wrapper = ReturnType<typeof mountInspector>

function lastChange(wrapper: Wrapper): Twin2dMark {
  const events = wrapper.emitted('change')
  if (!events?.length) throw new Error('没有抛出改动')
  return firstMark(events[events.length - 1]?.[0] as Twin2dConfig)
}

function lastMerge(wrapper: Wrapper): { mark: Twin2dMark; key: string } {
  const events = wrapper.emitted('merge')
  if (!events?.length) throw new Error('没有抛出合并改动')
  const frame = events[events.length - 1] ?? []
  return {
    mark: firstMark(frame[0] as Twin2dConfig),
    key: frame[1] as string,
  }
}

/** 分段控件里按中文名点一档。 */
async function clickSegment(
  wrapper: Wrapper,
  test: string,
  label: string,
): Promise<void> {
  const found = wrapper
    .find(`[data-test="${test}"]`)
    .findAll('button')
    .find((button) => button.text() === label)
  if (found === undefined) throw new Error(`${test} 里没有「${label}」这一档`)
  await found.trigger('click')
}

/** 数字框：改文本再落定，走的是控件自己的解析与夹取。 */
async function typeNumber(
  wrapper: Wrapper,
  test: string,
  text: string,
): Promise<void> {
  const input = wrapper.find(`[data-test="${test}"]`)
  await input.setValue(text)
  await input.trigger('change')
}

/** 按可访问名找一个分段控件，直接问它要事件（认不出的档位没法从界面上点出来）。 */
function segment(wrapper: Wrapper, ariaLabel: string) {
  const found = wrapper
    .findAllComponents(DtSegmented)
    .find((item) => item.props('ariaLabel') === ariaLabel)
  if (found === undefined) throw new Error(`没有「${ariaLabel}」这一组`)
  return found
}

function colorField(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(ColorField)
    .find((field) => field.props('label') === label)
  if (found === undefined) throw new Error(`没有「${label}」这一格`)
  return found
}

const RECT = { kind: 'rect', x: 10, y: 20, w: 100, h: 60 }
const LINE = { kind: 'line', x: 10, y: 20, x2: 90, y2: 40 }
const TEXT = { kind: 'text', x: 10, y: 20, text: '一号机组' }

describe('三档 kind', () => {
  it('三档都摆得出来', () => {
    const wrapper = mountInspector(RECT)

    const labels = wrapper
      .find('[data-test="mark-kind"]')
      .findAll('button')
      .map((button) => button.text())

    expect(labels).toHaveLength(TWIN_2D_MARK_KINDS.length)
  })

  it('换一档只改 kind', async () => {
    const wrapper = mountInspector(TEXT)

    await clickSegment(wrapper, 'mark-kind', '辅助框')

    expect(lastChange(wrapper).kind).toBe('rect')
  })

  it('换成同一档不写回', async () => {
    const wrapper = mountInspector(RECT)

    await clickSegment(wrapper, 'mark-kind', '辅助框')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('认不出的档位不写回', () => {
    const wrapper = mountInspector(RECT)

    segment(wrapper, '标注类型').vm.$emit('update:modelValue', '不存在的档')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 两端重合的辅助线画出来是零长的一条，看着像这一下什么都没发生
  it('换成辅助线时把重合的终点按框宽推开', async () => {
    const wrapper = mountInspector(RECT)

    await clickSegment(wrapper, 'mark-kind', '辅助线')

    expect(lastChange(wrapper)).toMatchObject({ kind: 'line', x2: 110, y2: 20 })
  })

  it('终点本来就不重合的不动它', async () => {
    const wrapper = mountInspector(LINE)

    await clickSegment(wrapper, 'mark-kind', '文字')

    expect(lastChange(wrapper)).toMatchObject({ kind: 'text', x2: 90, y2: 40 })
  })
})

describe('几何', () => {
  it('有框的两档量左上角与尺寸', () => {
    const wrapper = mountInspector(RECT)

    expect(wrapper.find('[data-test="mark-geom-w"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mark-geom-x2"]').exists()).toBe(false)
  })

  it('辅助线量两个端点', () => {
    const wrapper = mountInspector(LINE)

    expect(wrapper.find('[data-test="mark-geom-x2"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="mark-geom-w"]').exists()).toBe(false)
  })

  it('改一格只动那一格，走合并撤销', async () => {
    const wrapper = mountInspector(RECT)

    await typeNumber(wrapper, 'mark-geom-x', '42')

    const merged = lastMerge(wrapper)
    expect(merged.mark).toMatchObject({ x: 42, y: 20, w: 100, h: 60 })
    expect(merged.key).toBe('mark:m1:x')
  })

  it('终点也改得动', async () => {
    const wrapper = mountInspector(LINE)

    await typeNumber(wrapper, 'mark-geom-y2', '-15')

    expect(lastMerge(wrapper).mark.y2).toBe(-15)
  })

  // ⚠ 0 宽的框在画布上一根线都不剩，八个把手叠成一点谁也点不中
  it('宽高压不到 0', async () => {
    const wrapper = mountInspector(RECT)

    await typeNumber(wrapper, 'mark-geom-w', '0')

    expect(lastMerge(wrapper).mark.w).toBe(1)
  })

  it('清空的框按 0 写回', async () => {
    const wrapper = mountInspector(RECT)

    await typeNumber(wrapper, 'mark-geom-x', '')

    expect(lastMerge(wrapper).mark.x).toBe(0)
  })

  // ⚠ 数字框每次失焦都回抛一次当前值，不比一遍就白记一帧撤销
  it('值没变不记一帧', async () => {
    const wrapper = mountInspector(RECT)

    await typeNumber(wrapper, 'mark-geom-x', '10')

    expect(wrapper.emitted('merge')).toBeUndefined()
  })
})

describe('标签', () => {
  it('文字逐键走合并撤销', async () => {
    const wrapper = mountInspector(RECT)

    await wrapper.find('[data-test="mark-text"]').setValue('回水管')

    const merged = lastMerge(wrapper)
    expect(merged.mark.text).toBe('回水管')
    expect(merged.key).toBe('mark:m1:text')
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('焦点离开就断段', async () => {
    const wrapper = mountInspector(RECT)

    await wrapper.find('[data-test="mark-text"]').trigger('focusout')

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })

  it('三档位置改得动', async () => {
    const wrapper = mountInspector(RECT)

    await clickSegment(wrapper, 'mark-label-pos', '框内')

    expect(lastChange(wrapper).labelPos).toBe('inside')
  })

  it('认不出的位置不写回', () => {
    const wrapper = mountInspector(RECT)

    segment(wrapper, '标签位置').vm.$emit('update:modelValue', '斜上方')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 另两档的锚点是写死的，两条对齐在那两档上配了没反应
  it('标签不在框内时不摆两条对齐', () => {
    const wrapper = mountInspector(RECT)

    expect(wrapper.find('[data-test="mark-align-h"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="mark-align-hint"]').exists()).toBe(true)
  })

  it('标签落在框内时两条对齐都摆得出来', async () => {
    const wrapper = mountInspector({ ...RECT, labelPos: 'inside' })

    await clickSegment(wrapper, 'mark-align-h', '右')
    expect(lastChange(wrapper).labelAlignH).toBe('right')

    await clickSegment(wrapper, 'mark-align-v', '下')
    expect(lastChange(wrapper).labelAlignV).toBe('bottom')
  })

  it('认不出的对齐不写回', () => {
    const wrapper = mountInspector({ ...RECT, labelPos: 'inside' })

    segment(wrapper, '标签横向对齐').vm.$emit('update:modelValue', '偏左')
    segment(wrapper, '标签纵向对齐').vm.$emit('update:modelValue', '偏上')

    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('字体', () => {
  it('字体名写得进去', async () => {
    const wrapper = mountInspector(TEXT)

    await wrapper.find('[data-test="mark-font-family"]').setValue('思源黑体')

    const merged = lastMerge(wrapper)
    expect(merged.mark.font.family).toBe('思源黑体')
    expect(merged.key).toBe('mark:m1:font.family')
  })

  // ⚠ 缺席才是「跟随排版」，写一个显式的 undefined 会盖掉主题值
  it('清空字体名是删键而不是留一个空值', async () => {
    const wrapper = mountInspector({ ...TEXT, font: { family: '思源黑体' } })

    await wrapper.find('[data-test="mark-font-family"]').setValue('')

    expect('family' in lastMerge(wrapper).mark.font).toBe(false)
  })

  it('字号与字距写得进去', async () => {
    const wrapper = mountInspector(TEXT)

    await typeNumber(wrapper, 'mark-font-size', '24')
    expect(lastMerge(wrapper).mark.font.size).toBe(24)

    await typeNumber(wrapper, 'mark-font-spacing', '1.5')
    expect(lastMerge(wrapper).mark.font.letterSpacing).toBe(1.5)
  })

  it('字重落进文档是数字', () => {
    const wrapper = mountInspector(TEXT)

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '600')

    expect(lastMerge(wrapper).mark.font.weight).toBe(600)
  })

  it('字重选「跟随」是删键', () => {
    const wrapper = mountInspector({ ...TEXT, font: { weight: 700 } })

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '')

    expect('weight' in lastMerge(wrapper).mark.font).toBe(false)
  })

  it('字重没变不记一帧', () => {
    const wrapper = mountInspector({ ...TEXT, font: { weight: 600 } })

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', '600')

    expect(wrapper.emitted('merge')).toBeUndefined()
  })

  it('文字颜色写得进去，失焦断段', async () => {
    const wrapper = mountInspector(TEXT)
    const field = colorField(wrapper, '文字颜色')

    field.vm.$emit('update:modelValue', 'tomato')
    expect(lastMerge(wrapper).mark.font.color).toBe('tomato')

    field.vm.$emit('blur')
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('endMerge')).toBeTruthy()
  })
})

describe('描边与填充', () => {
  it('描边色写得进去', () => {
    const wrapper = mountInspector(RECT)

    colorField(wrapper, '描边色').vm.$emit('update:modelValue', 'tomato')

    const merged = lastMerge(wrapper)
    expect(merged.mark.stroke).toBe('tomato')
    expect(merged.key).toBe('mark:m1:stroke')
  })

  it('只有辅助框有填充', () => {
    expect(colorFieldExists(mountInspector(RECT), '填充色')).toBe(true)
    expect(colorFieldExists(mountInspector(LINE), '填充色')).toBe(false)
    expect(colorFieldExists(mountInspector(TEXT), '填充色')).toBe(false)
  })

  it('填充色写得进去', () => {
    const wrapper = mountInspector(RECT)

    colorField(wrapper, '填充色').vm.$emit('update:modelValue', 'teal')

    expect(lastMerge(wrapper).mark.fill).toBe('teal')
  })

  // ⚠ 文字标注的描边线宽/虚线/不随缩放全被标签自己的排版盖掉
  it('文字标注不摆那三格描边开关', () => {
    const wrapper = mountInspector(TEXT)

    expect(wrapper.find('[data-test="mark-stroke-width"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="mark-stroke-dash"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="mark-non-scaling"]').exists()).toBe(false)
  })

  it('线宽、虚线与不随缩放都改得动', async () => {
    const wrapper = mountInspector(RECT)

    await typeNumber(wrapper, 'mark-stroke-width', '4')
    expect(lastMerge(wrapper).mark.strokeWidth).toBe(4)

    await wrapper.find('[data-test="mark-stroke-dash"]').trigger('click')
    expect(lastChange(wrapper).strokeDash).toBe(true)

    await wrapper.find('[data-test="mark-non-scaling"]').trigger('click')
    expect(lastChange(wrapper).nonScalingStroke).toBe(true)
  })

  it('线宽清空按 0 写回', async () => {
    const wrapper = mountInspector({ ...RECT, strokeWidth: 3 })

    await typeNumber(wrapper, 'mark-stroke-width', '')

    expect(lastMerge(wrapper).mark.strokeWidth).toBe(0)
  })

  it('不透明度夹在 0 到 1 之间', async () => {
    const wrapper = mountInspector({ ...RECT, opacity: 0.4 })

    await typeNumber(wrapper, 'mark-opacity', '3')

    expect(lastMerge(wrapper).mark.opacity).toBe(1)
  })

  it('不透明度清空按不透明写回', async () => {
    const wrapper = mountInspector({ ...RECT, opacity: 0.4 })

    await typeNumber(wrapper, 'mark-opacity', '')

    expect(lastMerge(wrapper).mark.opacity).toBe(1)
  })

  it('不透明度改得动', async () => {
    const wrapper = mountInspector(RECT)

    await typeNumber(wrapper, 'mark-opacity', '0.35')

    expect(lastMerge(wrapper).mark.opacity).toBe(0.35)
  })
})

describe('相对节点层', () => {
  it('两档都摆得出来', () => {
    const wrapper = mountInspector(RECT)

    const labels = wrapper
      .find('[data-test="mark-z-order"]')
      .findAll('button')
      .map((button) => button.text())

    expect(labels).toHaveLength(TWIN_2D_MARK_Z_ORDERS.length)
  })

  // ⚠ 参考项目的编辑器不分层，配了 below 的标注上了大屏才发现跑到下面去了
  it('沉到节点之下与浮到节点之上都写得回', async () => {
    const above = mountInspector(RECT)
    await clickSegment(above, 'mark-z-order', '节点之上')
    expect(lastChange(above).zOrder).toBe('above')

    const below = mountInspector({ ...RECT, zOrder: 'above' })
    await clickSegment(below, 'mark-z-order', '节点之下')
    expect(lastChange(below).zOrder).toBe('below')
  })

  it('认不出的层不写回', () => {
    const wrapper = mountInspector(RECT)

    segment(wrapper, '相对节点层').vm.$emit('update:modelValue', '最上面')

    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('只读整份配置', () => {
  it('改动不落在入参那份配置上', async () => {
    const config = makeConfig(RECT)
    const wrapper = mount(MarkInspector, {
      props: { mark: firstMark(config), config },
    })

    await clickSegment(wrapper, 'mark-z-order', '节点之上')

    expect(firstMark(config).zOrder).toBe('below')
  })
})

function colorFieldExists(wrapper: Wrapper, label: string): boolean {
  return wrapper
    .findAllComponents(ColorField)
    .some((field) => field.props('label') === label)
}
