/**
 * @fileoverview 契约：画布的底图与图案底与运行态舞台逐字相同、网格跟着视口走（格距按
 * 倍率、起点按平移）、设计框那一圈遮罩按视口摆位，以及**整层一点指针都不吃**。
 *
 * ⚠ 底两层在这里另算一份不报错：底图偏一点、图案疏一格，而编辑器与大屏单看都对。
 * ⚠ 网格吃了指针不报错：它盖在整块画布上，点选、框选与拖放会全被这层装饰接走。
 * ⚠ 格距不足几个像素时线糊成一片实色，比没有网格更糟，所以那一档整层不画。
 * ⚠ 视口带 NaN 时 `left: NaNpx` 会让整块遮罩静默消失，而 devtools 里看什么都正常。
 */
import {
  Twin2dStage,
  __resetTwin2dAssets,
  configureTwin2dAssets,
  normalizeCanvas,
  twin2dImageUrl,
} from '@dt/twin2d'
import type { Twin2dCanvas } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import CanvasGrid from '@/pages/Twin2dEditor/components/CanvasGrid.vue'
import type { Twin2dViewport } from '@/pages/Twin2dEditor/scripts/viewportOps'

/** 画布 400×200：非方形，两轴写反了才看得出来。 */
const CANVAS = normalizeCanvas({
  width: 400,
  height: 200,
  grid: 20,
  showGrid: true,
})

/** 放大一倍并往左上挪：三个数各不相同，抄错一个就露馅。 */
const VIEW: Twin2dViewport = { scale: 2, tx: -100, ty: -50 }

function mountGrid(view: Twin2dViewport, canvas: Twin2dCanvas = CANVAS) {
  return mount(CanvasGrid, { props: { canvas, view } })
}

type Wrapper = ReturnType<typeof mountGrid>

function styleOf(wrapper: Wrapper, test: string): string {
  return wrapper.get(`[data-test="${test}"]`).attributes('style') ?? ''
}

/** 运行态舞台上同一块画布的那一层取值。 */
function stageLayerStyle(canvas: Twin2dCanvas, layer: string): string {
  const wrapper = mount(Twin2dStage, {
    props: {
      canvas,
      nodes: [],
      edges: [],
      marks: [],
      nodeStyles: [],
      edgeStyles: [],
      containerSize: { w: 800, h: 400 },
      live: { resolveImage: twin2dImageUrl },
    },
  })
  const style = wrapper.get(`[data-layer="${layer}"]`).attributes('style') ?? ''
  wrapper.unmount()
  return style
}

afterEach(() => {
  __resetTwin2dAssets()
})

describe('底图与图案底', () => {
  it('底图落进底层的内联样式里，铺法跟着配置走', () => {
    const canvas = normalizeCanvas({
      background: '/oss/plant.png',
      backgroundFit: 'contain',
    })

    expect(styleOf(mountGrid(VIEW, canvas), 'grid-background')).toContain(
      '--t2-bg: url("/oss/plant.png") center center / contain no-repeat',
    )
  })

  it('素材引用走应用壳注入的那条解析', () => {
    configureTwin2dAssets({
      resolveIcon: (ref) => `/oss/icons/${ref.slice('asset:'.length)}`,
      resolveImage: (ref) => `/oss/${ref.slice('asset:'.length)}`,
    })
    const canvas = normalizeCanvas({ background: 'asset:7f3a' })

    expect(styleOf(mountGrid(VIEW, canvas), 'grid-background')).toContain(
      'url("/oss/7f3a")',
    )
  })

  // ⚠ 没注入解析时整层不画，不发一个必 404 的请求
  it('没注入解析时素材引用一层都不画', () => {
    const canvas = normalizeCanvas({ background: 'asset:7f3a' })

    expect(styleOf(mountGrid(VIEW, canvas), 'grid-background')).toBe('')
  })

  it('图案底按配置出那一层的取值', () => {
    const canvas = normalizeCanvas({ pattern: 'dots', patternGap: 18 })

    const style = styleOf(mountGrid(VIEW, canvas), 'grid-pattern')
    expect(style).toContain('--t2-pattern: radial-gradient(')
    expect(style).toContain('background-size: 18px 18px')
  })

  it('底图留空、图案 none 时两层各自一条声明都不产', () => {
    const wrapper = mountGrid(VIEW)

    expect(styleOf(wrapper, 'grid-background')).toBe('')
    expect(styleOf(wrapper, 'grid-pattern')).toBe('')
  })

  it('两层的取值与运行态舞台上那两层逐字相同', () => {
    const canvas = normalizeCanvas({
      background: 'linear-gradient(180deg, #04121f, #071a2c)',
      pattern: 'weave',
      patternGap: 26,
    })
    const wrapper = mountGrid(VIEW, canvas)

    expect(styleOf(wrapper, 'grid-background')).toBe(
      stageLayerStyle(canvas, 'background'),
    )
    expect(styleOf(wrapper, 'grid-pattern')).toBe(
      stageLayerStyle(canvas, 'pattern'),
    )
  })

  // ⚠ 底两层住在设计坐标系里：照屏幕像素铺的话，缩放时图案的疏密不跟着变，
  // 而那与大屏上看到的对不上
  it('底两层是设计像素加一个缩放，不是屏幕像素', () => {
    const style = styleOf(mountGrid(VIEW), 'grid-backdrop')

    expect(style).toContain('width: 400px')
    expect(style).toContain('height: 200px')
    expect(style).toContain('transform: scale(2)')
    expect(style).toContain('left: -100px')
  })

  // ⚠ 反过来的话，配了底图的画布在编辑器里就没有网格可对齐了
  it('网格线压在底两层之上', () => {
    const wrapper = mountGrid(VIEW)
    const order = [...wrapper.get('[data-test="grid"]').element.children].map(
      (el) => el.getAttribute('data-test'),
    )

    expect(order).toEqual(['grid-backdrop', 'grid-lines', 'grid-frame'])
  })

  it('画布宽高不是数时底两层收成零宽零高，而不是 NaN', () => {
    const broken: Twin2dCanvas = { ...CANVAS, width: Number.NaN }

    const style = styleOf(mountGrid(VIEW, broken), 'grid-backdrop')

    expect(style).toContain('width: 0px')
    expect(style).not.toContain('NaN')
  })
})

describe('网格线', () => {
  it('格距按当前倍率换算，起点跟着平移走', () => {
    const style = styleOf(mountGrid(VIEW), 'grid-lines')

    expect(style).toContain('--t2-grid-step: 40px')
    expect(style).toContain('--t2-grid-x: -100px')
    expect(style).toContain('--t2-grid-y: -50px')
  })

  it('线色不进内联样式，只由样式表里那一个 token 出', () => {
    const style = styleOf(mountGrid(VIEW), 'grid-lines')

    expect(style).not.toContain('rgb')
    expect(style).not.toContain('#')
  })

  it('画布关了网格就只剩设计框那一圈', () => {
    const wrapper = mountGrid(VIEW, normalizeCanvas({ showGrid: false }))

    expect(wrapper.find('[data-test="grid-lines"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="grid-frame"]').exists()).toBe(true)
  })

  it('缩到格距不足几个像素时整层不画', () => {
    const dense = mountGrid({ scale: 0.15, tx: 0, ty: 0 })
    const sparse = mountGrid({ scale: 0.25, tx: 0, ty: 0 })

    expect(dense.find('[data-test="grid-lines"]').exists()).toBe(false)
    expect(sparse.find('[data-test="grid-lines"]').exists()).toBe(true)
  })
})

describe('设计框遮罩', () => {
  it('按视口把画布那块矩形摆到屏幕上', () => {
    const style = styleOf(mountGrid(VIEW), 'grid-frame')

    expect(style).toContain('left: -100px')
    expect(style).toContain('top: -50px')
    expect(style).toContain('width: 800px')
    expect(style).toContain('height: 400px')
  })

  it('缩小之后矩形跟着缩，不是恒定的设计尺寸', () => {
    const style = styleOf(
      mountGrid({ scale: 0.5, tx: 10, ty: 20 }),
      'grid-frame',
    )

    expect(style).toContain('width: 200px')
    expect(style).toContain('height: 100px')
    expect(style).toContain('left: 10px')
  })
})

describe('不产 NaN', () => {
  it('视口带非有限值时两层都退到有限取值', () => {
    const wrapper = mountGrid({ scale: Number.NaN, tx: Number.NaN, ty: 0 })

    expect(styleOf(wrapper, 'grid-frame')).not.toContain('NaN')
    expect(styleOf(wrapper, 'grid-lines')).not.toContain('NaN')
  })

  it('画布宽高不是数时矩形收成零宽零高，而不是整块消失', () => {
    const broken: Twin2dCanvas = { ...CANVAS, width: Number.NaN }

    const style = styleOf(mountGrid(VIEW, broken), 'grid-frame')

    expect(style).toContain('width: 0px')
    expect(style).toContain('height: 400px')
  })
})

describe('纯装饰', () => {
  it('整层不吃指针，画布上的点击照旧落到底下的层上', () => {
    const wrapper = mountGrid(VIEW)

    expect(styleOf(wrapper, 'grid')).toContain('pointer-events: none')
  })
})
