/**
 * @fileoverview 契约：标注渲染件的三档几何与标签落点，逐值钉在参考项目那份排版上
 * ——框内九宫格贴边 10、框外上下各 8、辅助线上方 10 下方 14，外加三档 SVG 基线。
 *
 * ⚠ 落点算错不会报错，只是标签飘到框外或压在线上；这类偏移一旦漂了，回头没有任何
 * 一处能说出「原本该是多少」，所以数值只在这里锁一次。
 * ⚠ 描边与填充留空是合法配置（= 由渲染层回退），补一个具体颜色等于把主题色写死进
 * 文档，所以两处回退也要有断言。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { normalizeMark } from '../../src/normalizeMarks'
import Twin2dMarkShape from '../../src/render/Twin2dMarkShape.vue'
import type { Twin2dMark } from '../../src/types'

/** 造一条归一化过的标注；造不出来直接抛，省得后面对着 null 断言。 */
function markOf(raw: Record<string, unknown>): Twin2dMark {
  const mark = normalizeMark(raw)
  if (mark === null) throw new Error('标注造不出来')
  return mark
}

/** 一条有框的标注：左上角 (100, 50)、200 × 80。 */
function boxMark(patch: Record<string, unknown> = {}): Twin2dMark {
  return markOf({
    id: 'm1',
    kind: 'rect',
    x: 100,
    y: 50,
    w: 200,
    h: 80,
    text: '一号机组',
    ...patch,
  })
}

/** 一条辅助线：(10, 20) → (110, 80)，中点 (60, 50)。 */
function lineMark(patch: Record<string, unknown> = {}): Twin2dMark {
  return markOf({
    id: 'l1',
    kind: 'line',
    x: 10,
    y: 20,
    x2: 110,
    y2: 80,
    text: '母线',
    ...patch,
  })
}

/** 挂起来读标签上的四项。 */
function labelOf(mark: Twin2dMark): Record<string, string | undefined> {
  const wrapper = mount(Twin2dMarkShape, { props: { mark } })
  const label = wrapper.find('[data-test="mark-label"]')
  const attrs = {
    x: label.attributes('x'),
    y: label.attributes('y'),
    anchor: label.attributes('text-anchor'),
    baseline: label.attributes('dominant-baseline'),
  }
  wrapper.unmount()
  return attrs
}

describe('框外那两档', () => {
  it('摆在框上方时抬 8 个像素，基线落在字脚', () => {
    expect(labelOf(boxMark({ labelPos: 'top' }))).toEqual({
      x: '200',
      y: '42',
      anchor: 'middle',
      baseline: 'auto',
    })
  })

  it('摆在框下方时沉 8 个像素，基线改挂在字顶', () => {
    expect(labelOf(boxMark({ labelPos: 'bottom' }))).toEqual({
      x: '200',
      y: '138',
      anchor: 'middle',
      baseline: 'hanging',
    })
  })
})

describe('框内九宫格', () => {
  it('左上角贴边留白 10', () => {
    const mark = boxMark({
      labelPos: 'inside',
      labelAlignH: 'left',
      labelAlignV: 'top',
    })

    expect(labelOf(mark)).toEqual({
      x: '110',
      y: '60',
      anchor: 'start',
      baseline: 'hanging',
    })
  })

  it('居中那一档落在框心', () => {
    const mark = boxMark({
      labelPos: 'inside',
      labelAlignH: 'center',
      labelAlignV: 'middle',
    })

    expect(labelOf(mark)).toEqual({
      x: '200',
      y: '90',
      anchor: 'middle',
      baseline: 'middle',
    })
  })

  it('右下角同样留白 10，两条对齐各自换到末档', () => {
    const mark = boxMark({
      labelPos: 'inside',
      labelAlignH: 'right',
      labelAlignV: 'bottom',
    })

    expect(labelOf(mark)).toEqual({
      x: '290',
      y: '120',
      anchor: 'end',
      baseline: 'auto',
    })
  })
})

describe('辅助线的标签', () => {
  it('锚在两端中点，上方那一档抬 10', () => {
    expect(labelOf(lineMark({ labelPos: 'top' }))).toEqual({
      x: '60',
      y: '40',
      anchor: 'middle',
      baseline: 'auto',
    })
  })

  it('下方那一档沉 14，不与上方对称', () => {
    expect(labelOf(lineMark({ labelPos: 'bottom' }))).toEqual({
      x: '60',
      y: '64',
      anchor: 'middle',
      baseline: 'hanging',
    })
  })

  it('压在线上那一档落在中点', () => {
    expect(labelOf(lineMark({ labelPos: 'inside' }))).toEqual({
      x: '60',
      y: '50',
      anchor: 'middle',
      baseline: 'middle',
    })
  })
})

describe('三档几何', () => {
  it('框那一档画成矩形，四个坐标照文档来', () => {
    const wrapper = mount(Twin2dMarkShape, { props: { mark: boxMark() } })
    const shape = wrapper.find('[data-test="mark-shape"]')

    expect(shape.element.tagName.toLowerCase()).toBe('rect')
    expect([
      shape.attributes('x'),
      shape.attributes('y'),
      shape.attributes('width'),
      shape.attributes('height'),
    ]).toEqual(['100', '50', '200', '80'])
    wrapper.unmount()
  })

  it('线那一档画成线段，吃的是终点而不是宽高', () => {
    const wrapper = mount(Twin2dMarkShape, { props: { mark: lineMark() } })
    const shape = wrapper.find('[data-test="mark-shape"]')

    expect(shape.element.tagName.toLowerCase()).toBe('line')
    expect([
      shape.attributes('x1'),
      shape.attributes('y1'),
      shape.attributes('x2'),
      shape.attributes('y2'),
    ]).toEqual(['10', '20', '110', '80'])
    wrapper.unmount()
  })

  it('文字那一档一个形状都不画，排版仍走有框的那一套', () => {
    const mark = markOf({
      id: 't1',
      kind: 'text',
      x: 100,
      y: 50,
      w: 200,
      h: 80,
      text: '网络标号',
      labelPos: 'inside',
      labelAlignH: 'center',
      labelAlignV: 'middle',
    })
    const wrapper = mount(Twin2dMarkShape, { props: { mark } })

    expect(wrapper.find('[data-test="mark-shape"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="mark-label"]').attributes('x')).toBe('200')
    wrapper.unmount()
  })

  it('没有文字就不出标签元素', () => {
    const wrapper = mount(Twin2dMarkShape, {
      props: { mark: boxMark({ text: '' }) },
    })

    expect(wrapper.find('[data-test="mark-label"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('留空的那几项', () => {
  it('描边留空落回强调色，填充留空不画填充', () => {
    const wrapper = mount(Twin2dMarkShape, { props: { mark: boxMark() } })

    expect(wrapper.find('[data-test="mark"]').attributes('stroke')).toBe(
      'var(--accent-primary)',
    )
    expect(wrapper.find('[data-test="mark-shape"]').attributes('fill')).toBe(
      'none',
    )
    wrapper.unmount()
  })

  it('标签色留空时跟随描边色', () => {
    const mark = boxMark({ stroke: 'var(--status-alarm)' })
    const wrapper = mount(Twin2dMarkShape, { props: { mark } })

    expect(wrapper.find('[data-test="mark-label"]').attributes('fill')).toBe(
      'var(--status-alarm)',
    )
    wrapper.unmount()
  })

  it('字体色压过描边色，另外几键落进内联样式', () => {
    const mark = boxMark({
      stroke: 'var(--status-alarm)',
      font: {
        color: 'var(--text-primary)',
        family: 'var(--font-digit)',
        size: 22,
        weight: 500,
        letterSpacing: 1.5,
      },
    })
    const wrapper = mount(Twin2dMarkShape, { props: { mark } })
    const label = wrapper.find('[data-test="mark-label"]')

    expect(label.attributes('fill')).toBe('var(--text-primary)')
    expect(label.attributes('style')).toContain('font-size: 22px')
    expect(label.attributes('style')).toContain('font-weight: 500')
    expect(label.attributes('style')).toContain(
      'font-family: var(--font-digit)',
    )
    expect(label.attributes('style')).toContain('letter-spacing: 1.5px')
    wrapper.unmount()
  })

  it('字体一键都没给时一条声明都不产', () => {
    const wrapper = mount(Twin2dMarkShape, { props: { mark: boxMark() } })
    const label = wrapper.find('[data-test="mark-label"]')

    expect(label.attributes('style')).toBeUndefined()
    wrapper.unmount()
  })

  it('注进来的字体族带括号时按脏值挡掉', () => {
    const mark = boxMark({ font: { family: 'url(evil.css)' } })
    const wrapper = mount(Twin2dMarkShape, { props: { mark } })

    expect(wrapper.find('[data-test="mark-label"]').attributes('style')).toBe(
      undefined,
    )
    wrapper.unmount()
  })
})

describe('描边那几项', () => {
  it('虚线开着才出 dasharray', () => {
    const solid = mount(Twin2dMarkShape, { props: { mark: boxMark() } })
    const dashed = mount(Twin2dMarkShape, {
      props: { mark: boxMark({ strokeDash: true }) },
    })

    expect(
      solid.find('[data-test="mark"]').attributes('stroke-dasharray'),
    ).toBeUndefined()
    expect(
      dashed.find('[data-test="mark"]').attributes('stroke-dasharray'),
    ).toBe('10 7')
    solid.unmount()
    dashed.unmount()
  })

  it('描边不随舞台缩放是显式开关，关着时属性根本不出现', () => {
    const scaling = mount(Twin2dMarkShape, { props: { mark: boxMark() } })
    const fixed = mount(Twin2dMarkShape, {
      props: { mark: boxMark({ nonScalingStroke: true }) },
    })

    expect(
      scaling.find('[data-test="mark-shape"]').attributes('vector-effect'),
    ).toBeUndefined()
    expect(
      fixed.find('[data-test="mark-shape"]').attributes('vector-effect'),
    ).toBe('non-scaling-stroke')
    scaling.unmount()
    fixed.unmount()
  })

  it('线宽与透明度挂在整条标注上，形状与标签一起吃', () => {
    const mark = boxMark({ strokeWidth: 3, opacity: 0.4 })
    const wrapper = mount(Twin2dMarkShape, { props: { mark } })
    const root = wrapper.find('[data-test="mark"]')

    expect(root.attributes('stroke-width')).toBe('3')
    expect(root.attributes('opacity')).toBe('0.4')
    wrapper.unmount()
  })
})
