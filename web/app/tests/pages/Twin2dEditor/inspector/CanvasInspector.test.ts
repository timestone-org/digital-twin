/**
 * @fileoverview 契约：画布检查器把宽高、网格、底图与四档铺法、底纹四档与它的
 * 颜色/间距/线宽都摆得出来，改动只以整份新配置往上抛。
 *
 * ⚠ 画布宽高与大屏的 designWidth/Height 无关，是这张图自己的坐标系：面上必须写着
 * 这句话，不然用户会以为改它能改大屏分辨率。这条按「说明文字在」钉住。
 * ⚠ 下限与归一化共用同一份常量：抄一个数在检查器里，改常量时这一格会悄悄放行更小的
 * 画布，而画面上要过很久才看得出不对。
 * ⚠ 没配底图就没有铺法可言，底纹关着时颜色/间距/线宽同理——摆一个配了没反应的控件
 * 比没有更糟。
 */
import {
  TWIN_2D_BACKGROUND_FITS,
  TWIN_2D_MIN_CANVAS_SIZE,
  TWIN_2D_MIN_GRID,
  TWIN_2D_PATTERNS,
  normalizeTwin2dConfig,
} from '@dt/twin2d'
import type { Twin2dCanvas, Twin2dConfig } from '@dt/twin2d'
import { DtSegmented } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ColorField from '@/pages/Twin2dEditor/components/fields/ColorField.vue'
import CanvasInspector from '@/pages/Twin2dEditor/components/inspector/CanvasInspector.vue'

/** 夹具走一遍归一化，字段口径与真文档逐字相同。 */
function makeConfig(canvas: Record<string, unknown>): Twin2dConfig {
  return normalizeTwin2dConfig({ canvas })
}

function mountInspector(canvas: Record<string, unknown> = {}) {
  return mount(CanvasInspector, { props: { config: makeConfig(canvas) } })
}

type Wrapper = ReturnType<typeof mountInspector>

function lastChange(wrapper: Wrapper): Twin2dCanvas {
  const events = wrapper.emitted('change')
  if (!events?.length) throw new Error('没有抛出改动')
  return (events[events.length - 1]?.[0] as Twin2dConfig).canvas
}

function lastMerge(wrapper: Wrapper): { canvas: Twin2dCanvas; key: string } {
  const events = wrapper.emitted('merge')
  if (!events?.length) throw new Error('没有抛出合并改动')
  const frame = events[events.length - 1] ?? []
  return {
    canvas: (frame[0] as Twin2dConfig).canvas,
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

/** 按可访问名找一个分段控件，直接问它要事件（认不出的档位没法从界面上点出来）。 */
function segment(wrapper: Wrapper, ariaLabel: string) {
  const found = wrapper
    .findAllComponents(DtSegmented)
    .find((item) => item.props('ariaLabel') === ariaLabel)
  if (found === undefined) throw new Error(`没有「${ariaLabel}」这一组`)
  return found
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

describe('尺寸', () => {
  it('宽高改得动，走合并撤销', async () => {
    const wrapper = mountInspector()

    await typeNumber(wrapper, 'canvas-width', '1600')
    expect(lastMerge(wrapper)).toMatchObject({
      canvas: { width: 1600 },
      key: 'canvas:width',
    })

    await typeNumber(wrapper, 'canvas-height', '900')
    expect(lastMerge(wrapper).canvas.height).toBe(900)
  })

  // ⚠ 下限抄一个数在这里，改常量时这一格会悄悄放行更小的画布
  it('小于下限的一律拉回下限', async () => {
    const wrapper = mountInspector()

    await typeNumber(wrapper, 'canvas-width', '10')

    expect(lastMerge(wrapper).canvas.width).toBe(TWIN_2D_MIN_CANVAS_SIZE)
  })

  it('清空的框按下限写回', async () => {
    const wrapper = mountInspector()

    await typeNumber(wrapper, 'canvas-height', '')

    expect(lastMerge(wrapper).canvas.height).toBe(TWIN_2D_MIN_CANVAS_SIZE)
  })

  // ⚠ 不写这句话，用户会以为改画布尺寸能改大屏分辨率
  it('面上写着与大屏分辨率无关', () => {
    const wrapper = mountInspector()

    expect(wrapper.find('[data-test="canvas-size-hint"]').text()).toContain(
      '与大屏分辨率无关',
    )
  })

  // ⚠ 数字框每次失焦都回抛一次当前值，不比一遍就白记一帧撤销
  it('值没变不记一帧', async () => {
    const wrapper = mountInspector({ width: 1600 })

    await typeNumber(wrapper, 'canvas-width', '1600')

    expect(wrapper.emitted('merge')).toBeUndefined()
  })
})

describe('网格', () => {
  it('显示开关切得动', async () => {
    const wrapper = mountInspector()

    await wrapper.find('[data-test="canvas-show-grid"]').trigger('click')

    expect(lastChange(wrapper).showGrid).toBe(true)
  })

  it('步长改得动', async () => {
    const wrapper = mountInspector()

    await typeNumber(wrapper, 'canvas-grid', '32')

    expect(lastMerge(wrapper)).toMatchObject({
      canvas: { grid: 32 },
      key: 'canvas:grid',
    })
  })

  it('步长夹在上下限之间', async () => {
    const wrapper = mountInspector()

    await typeNumber(wrapper, 'canvas-grid', '1')

    expect(lastMerge(wrapper).canvas.grid).toBe(TWIN_2D_MIN_GRID)
  })

  // ⚠ 0 会让吸附整个静默失效：拖起来一格都不对齐，而哪里都不报错
  it('清空的步长按下限写回', async () => {
    const wrapper = mountInspector()

    await typeNumber(wrapper, 'canvas-grid', '')

    expect(lastMerge(wrapper).canvas.grid).toBe(TWIN_2D_MIN_GRID)
  })
})

describe('底图', () => {
  it('四种写法都写得进去，逐键合并撤销', async () => {
    const wrapper = mountInspector()

    await wrapper
      .find('[data-test="canvas-background"]')
      .setValue('asset:0191ab')

    expect(lastMerge(wrapper)).toMatchObject({
      canvas: { background: 'asset:0191ab' },
      key: 'canvas:background',
    })
  })

  // ⚠ 没配底图就没有铺法可言
  it('没配底图就不摆铺法', () => {
    expect(
      mountInspector().find('[data-test="canvas-background-fit"]').exists(),
    ).toBe(false)
  })

  it('配了底图才摆铺法，四档一档不少', () => {
    const wrapper = mountInspector({ background: 'asset:0191ab' })

    const labels = wrapper
      .find('[data-test="canvas-background-fit"]')
      .findAll('button')
      .map((button) => button.text())

    expect(labels).toHaveLength(TWIN_2D_BACKGROUND_FITS.length)
  })

  it('换一档铺法', async () => {
    const wrapper = mountInspector({ background: 'asset:0191ab' })

    await clickSegment(wrapper, 'canvas-background-fit', '平铺')

    expect(lastChange(wrapper).backgroundFit).toBe('tile')
  })

  it('认不出的铺法不写回', () => {
    const wrapper = mountInspector({ background: 'asset:0191ab' })

    segment(wrapper, '底图铺法').vm.$emit('update:modelValue', '铺满整屏')

    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('底纹', () => {
  it('四档一档不少', () => {
    const wrapper = mountInspector()

    const labels = wrapper
      .find('[data-test="canvas-pattern"]')
      .findAll('button')
      .map((button) => button.text())

    expect(labels).toHaveLength(TWIN_2D_PATTERNS.length)
  })

  it('换一档图案', async () => {
    const wrapper = mountInspector()

    await clickSegment(wrapper, 'canvas-pattern', '点阵')

    expect(lastChange(wrapper).pattern).toBe('dots')
  })

  it('认不出的图案不写回', () => {
    const wrapper = mountInspector()

    segment(wrapper, '底纹图案').vm.$emit('update:modelValue', '网格纸')

    expect(wrapper.emitted('change')).toBeUndefined()
  })

  // ⚠ 底纹关着时这三格配了没反应
  it('没开底纹就不摆颜色、间距与线宽', () => {
    const wrapper = mountInspector()

    expect(wrapper.findAllComponents(ColorField)).toHaveLength(0)
    expect(wrapper.find('[data-test="canvas-pattern-gap"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('[data-test="canvas-pattern-width"]').exists()).toBe(
      false,
    )
  })

  it('开了底纹三格都在，颜色写得回', () => {
    const wrapper = mountInspector({ pattern: 'weave' })

    wrapper.findComponent(ColorField).vm.$emit('update:modelValue', 'slategray')

    expect(lastMerge(wrapper)).toMatchObject({
      canvas: { patternColor: 'slategray' },
      key: 'canvas:patternColor',
    })
  })

  it('间距与线宽改得动', async () => {
    const wrapper = mountInspector({ pattern: 'lines', patternWidth: 3 })

    await typeNumber(wrapper, 'canvas-pattern-gap', '40')
    expect(lastMerge(wrapper).canvas.patternGap).toBe(40)

    await typeNumber(wrapper, 'canvas-pattern-width', '2')
    expect(lastMerge(wrapper).canvas.patternWidth).toBe(2)
  })

  it('清空的间距与线宽各按自己的下限写回', async () => {
    const wrapper = mountInspector({ pattern: 'dots', patternWidth: 3 })

    await typeNumber(wrapper, 'canvas-pattern-gap', '')
    expect(lastMerge(wrapper).canvas.patternGap).toBe(TWIN_2D_MIN_GRID)

    await typeNumber(wrapper, 'canvas-pattern-width', '')
    expect(lastMerge(wrapper).canvas.patternWidth).toBe(1)
  })
})

describe('撤销分段与只读', () => {
  it('焦点离开就断段', async () => {
    const wrapper = mountInspector()

    await wrapper.find('[data-test="canvas-background"]').trigger('focusout')

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })

  it('颜色框失焦也断段', async () => {
    const wrapper = mountInspector({ pattern: 'dots' })

    wrapper.findComponent(ColorField).vm.$emit('blur')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('endMerge')).toHaveLength(1)
  })

  it('改动不落在入参那份配置上', async () => {
    const config = makeConfig({})
    const wrapper = mount(CanvasInspector, { props: { config } })

    await wrapper.find('[data-test="canvas-show-grid"]').trigger('click')

    expect(config.canvas.showGrid).toBe(false)
  })
})
