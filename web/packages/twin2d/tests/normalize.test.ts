/**
 * @fileoverview 守整份文档入口的口径：画布的每一档缺省与夹取、版本号只认显式正整数、
 * 「先节点后连线」的顺序（顺序倒了悬空连线会被当成合法的留下来），以及幂等与
 * 「输出里没有 undefined」——后两条错了 JSON 往返一次图就变形，而没有一处会报错。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_CONFIG_VERSION,
  TWIN_2D_DEFAULT_CANVAS_HEIGHT,
  TWIN_2D_DEFAULT_CANVAS_WIDTH,
  TWIN_2D_DEFAULT_GRID,
  TWIN_2D_DEFAULT_PATTERN_GAP,
  TWIN_2D_DEFAULT_PATTERN_WIDTH,
  TWIN_2D_MAX_CANVAS_SIZE,
  TWIN_2D_MAX_GRID,
  TWIN_2D_MIN_CANVAS_SIZE,
  TWIN_2D_MIN_GRID,
} from '../src/constants'
import { normalizeCanvas, normalizeTwin2dConfig } from '../src/normalize'

/** 两个节点加一条连着它们的线 */
const LINKED = {
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ id: 'e1', from: { nodeId: 'a' }, to: { nodeId: 'b' } }],
}

function hasUndefined(value: unknown): boolean {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.some(hasUndefined)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(hasUndefined)
  }
  return false
}

describe('画布', () => {
  it('不是对象时整块回缺省画布', () => {
    expect(normalizeCanvas(undefined)).toEqual({
      width: TWIN_2D_DEFAULT_CANVAS_WIDTH,
      height: TWIN_2D_DEFAULT_CANVAS_HEIGHT,
      grid: TWIN_2D_DEFAULT_GRID,
      showGrid: false,
      background: '',
      backgroundFit: 'cover',
      pattern: 'none',
      patternColor: '',
      patternGap: TWIN_2D_DEFAULT_PATTERN_GAP,
      patternWidth: TWIN_2D_DEFAULT_PATTERN_WIDTH,
    })
    expect(normalizeCanvas([1, 2])).toEqual(normalizeCanvas(null))
  })

  it('给全了就原样收，数字串也算数', () => {
    expect(
      normalizeCanvas({
        width: '1600',
        height: 900,
        grid: 40,
        showGrid: true,
        background: ' asset:abc ',
        backgroundFit: 'tile',
        pattern: 'weave',
        patternColor: ' #123456 ',
        patternGap: 26,
        patternWidth: 2,
      }),
    ).toEqual({
      width: 1600,
      height: 900,
      grid: 40,
      showGrid: true,
      background: 'asset:abc',
      backgroundFit: 'tile',
      pattern: 'weave',
      patternColor: '#123456',
      patternGap: 26,
      patternWidth: 2,
    })
  })

  it('边长 0 与负数回缺省，太小太大都夹进上下界', () => {
    expect(normalizeCanvas({ width: 0 }).width).toBe(
      TWIN_2D_DEFAULT_CANVAS_WIDTH,
    )
    expect(normalizeCanvas({ height: -10 }).height).toBe(
      TWIN_2D_DEFAULT_CANVAS_HEIGHT,
    )
    expect(normalizeCanvas({ width: 3 }).width).toBe(TWIN_2D_MIN_CANVAS_SIZE)
    expect(normalizeCanvas({ height: 1e9 }).height).toBe(
      TWIN_2D_MAX_CANVAS_SIZE,
    )
    expect(normalizeCanvas({ width: Number.NaN }).width).toBe(
      TWIN_2D_DEFAULT_CANVAS_WIDTH,
    )
  })

  it('网格步长取整后夹进 [2,200]，取不到数才回缺省', () => {
    expect(normalizeCanvas({ grid: 3.6 }).grid).toBe(4)
    expect(normalizeCanvas({ grid: 0 }).grid).toBe(TWIN_2D_MIN_GRID)
    expect(normalizeCanvas({ grid: 5000 }).grid).toBe(TWIN_2D_MAX_GRID)
    expect(normalizeCanvas({ grid: 'x' }).grid).toBe(TWIN_2D_DEFAULT_GRID)
  })

  it('showGrid 只认真布尔，缺省不画网格', () => {
    expect(normalizeCanvas({ showGrid: 1 }).showGrid).toBe(false)
    expect(normalizeCanvas({ showGrid: false }).showGrid).toBe(false)
  })

  it('底图与底纹色只 trim，CSS 消毒是渲染层的事', () => {
    const canvas = normalizeCanvas({
      background: '  linear-gradient(red, blue)  ',
      patternColor: 42,
    })
    expect(canvas.background).toBe('linear-gradient(red, blue)')
    expect(canvas.patternColor).toBe('')
  })

  it('铺法与底纹认不出时回缺省档', () => {
    const canvas = normalizeCanvas({ backgroundFit: 'fill', pattern: 'mesh' })
    expect(canvas.backgroundFit).toBe('cover')
    expect(canvas.pattern).toBe('none')
  })

  it('底纹间距与线宽是尺寸类正数，0 与负数回缺省', () => {
    expect(normalizeCanvas({ patternGap: 0 }).patternGap).toBe(
      TWIN_2D_DEFAULT_PATTERN_GAP,
    )
    expect(normalizeCanvas({ patternWidth: -1 }).patternWidth).toBe(
      TWIN_2D_DEFAULT_PATTERN_WIDTH,
    )
    expect(normalizeCanvas({ patternGap: 12.5 }).patternGap).toBe(12.5)
  })
})

describe('文档版本', () => {
  it('缺失、非数、小数与非正数一律回本版', () => {
    expect(normalizeTwin2dConfig({}).version).toBe(TWIN_2D_CONFIG_VERSION)
    expect(normalizeTwin2dConfig({ version: 'v1' }).version).toBe(
      TWIN_2D_CONFIG_VERSION,
    )
    expect(normalizeTwin2dConfig({ version: 1.5 }).version).toBe(
      TWIN_2D_CONFIG_VERSION,
    )
    expect(normalizeTwin2dConfig({ version: 0 }).version).toBe(
      TWIN_2D_CONFIG_VERSION,
    )
    expect(normalizeTwin2dConfig({ version: -3 }).version).toBe(
      TWIN_2D_CONFIG_VERSION,
    )
  })

  it('正整数原样留下，包括比本版新的号码', () => {
    expect(normalizeTwin2dConfig({ version: 1 }).version).toBe(1)
    expect(normalizeTwin2dConfig({ version: '2' }).version).toBe(2)
    expect(normalizeTwin2dConfig({ version: 7 }).version).toBe(7)
  })
})

describe('整份文档', () => {
  it('不是对象时是一份空文档：五张表都空，画布是缺省画布', () => {
    const config = normalizeTwin2dConfig('twin2d')
    expect(config).toEqual({
      version: TWIN_2D_CONFIG_VERSION,
      canvas: normalizeCanvas(undefined),
      styles: [],
      edgeStyles: [],
      nodes: [],
      edges: [],
      marks: [],
    })
  })

  it('五张表不是数组时各自是空数组', () => {
    const config = normalizeTwin2dConfig({
      styles: 'x',
      edgeStyles: 1,
      nodes: null,
      edges: {},
      marks: false,
    })
    expect(config.styles).toEqual([])
    expect(config.edgeStyles).toEqual([])
    expect(config.nodes).toEqual([])
    expect(config.edges).toEqual([])
    expect(config.marks).toEqual([])
  })

  it('五张表各自收进自己那一族', () => {
    const config = normalizeTwin2dConfig({
      ...LINKED,
      styles: [{ id: 's1', name: '泵' }],
      edgeStyles: [{ id: 'water' }],
      marks: [{ id: 'm1', kind: 'text', text: '一号线' }],
    })
    expect(config.styles.map((style) => style.id)).toEqual(['s1'])
    expect(config.edgeStyles.map((style) => style.id)).toEqual(['water'])
    expect(config.nodes.map((node) => node.id)).toEqual(['a', 'b'])
    expect(config.edges.map((edge) => edge.id)).toEqual(['e1'])
    expect(config.marks.map((mark) => mark.id)).toEqual(['m1'])
  })

  it('连线拿的是归一化之后还在的节点，指到被丢掉的节点就整条丢', () => {
    const config = normalizeTwin2dConfig({
      // 第二个节点没有 id，归一化时整条丢弃
      nodes: [{ id: 'a' }, { x: 10 }],
      edges: [
        { id: 'keep', from: { nodeId: 'a' }, to: { nodeId: 'a' } },
        { id: 'drop', from: { nodeId: 'a' }, to: { nodeId: 'ghost' } },
      ],
    })
    expect(config.nodes.map((node) => node.id)).toEqual(['a'])
    expect(config.edges.map((edge) => edge.id)).toEqual(['keep'])
  })

  it('文档序就是绑定行序：脏条目丢掉后其后的整体前移一格', () => {
    const config = normalizeTwin2dConfig({
      nodes: [{ id: 'a' }, 'not-a-node', { id: 'c' }],
    })
    expect(config.nodes.map((node) => node.id)).toEqual(['a', 'c'])
  })

  it('幂等：归一两次与一次逐字段相同', () => {
    const once = normalizeTwin2dConfig({
      ...LINKED,
      version: 3,
      canvas: { width: 3, grid: 3.6, pattern: 'dots' },
      styles: [{ id: 's1', prims: [{ id: 'root', kind: 'box' }] }],
      edgeStyles: [{ id: 'water' }],
      marks: [{ id: 'm1', kind: 'rect' }],
    })
    expect(normalizeTwin2dConfig(once)).toEqual(once)
  })

  it('输出里没有 undefined，JSON 往返一次也不变形', () => {
    const config = normalizeTwin2dConfig({
      ...LINKED,
      styles: [{ id: 's1', prims: [{ id: 'root', kind: 'box' }] }],
      marks: [{ id: 'm1', kind: 'line', font: { size: 12 } }],
    })
    expect(hasUndefined(config)).toBe(false)
    expect(JSON.parse(JSON.stringify(config))).toEqual(config)
  })

  it('每次都是一份新对象：舞台按引用比对，同一份输入要由调用方缓存', () => {
    const raw = { ...LINKED }
    expect(normalizeTwin2dConfig(raw)).not.toBe(normalizeTwin2dConfig(raw))
    expect(normalizeTwin2dConfig(raw)).toEqual(normalizeTwin2dConfig(raw))
  })
})
