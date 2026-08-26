/**
 * @fileoverview 锁住 8 枚 GB/T 4728 电路符号这批**数据**：每枚的身份、图元树、端口落点
 * 与引脚线宽逐项钉死；二极管另按 4 档 rotate × 4 种 flip 的 16 组端口世界坐标锁住位姿
 * 复合顺序，与 tests/transform.test.ts 同一份口径。
 * ⚠ 最后一条「8 枚只用 vec/txt 两种图元 kind」是防退化的那道闸：预置库是数据不是渲染
 * 分支，少了它「预置数据」会慢慢长回渲染件里的 `if (styleId === '…')`，而这个退化过程
 * 没有任何一步会报错。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_CIRCUIT_CAPACITOR,
  TWIN_2D_CIRCUIT_DIODE,
  TWIN_2D_CIRCUIT_GROUND,
  TWIN_2D_CIRCUIT_INDUCTOR,
  TWIN_2D_CIRCUIT_JUNCTION,
  TWIN_2D_CIRCUIT_RESISTOR,
  TWIN_2D_CIRCUIT_SOURCE,
  TWIN_2D_CIRCUIT_STYLES,
  TWIN_2D_CIRCUIT_SWITCH,
} from '../../src/presets/circuit'
import { portWorldPos, portWorldSide } from '../../src/transform'
import type { Twin2dNodeRotation } from '../../src/kinds'
import type { Twin2dNode, Twin2dNodeStyle, Twin2dPort } from '../../src/types'
import type { Twin2dPrim, Twin2dShape } from '../../src/typesPrim'

/** 一个二维点 */
interface Xy {
  x: number
  y: number
}

const BASE_NODE: Twin2dNode = {
  id: 'n1',
  styleId: '',
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: 'R1',
  labelPos: 'bottom',
  status: '',
  accent: '',
  badge: '',
  badgeColor: '',
  badgeShape: 'round',
  tags: {},
  slots: [],
  layers: [],
  patch: {},
  ports: [],
}

/** 落在原点、尺寸跟样式走的一个实例：端口世界坐标就等于符号的设计坐标 */
function nodeOf(style: Twin2dNodeStyle): Twin2dNode {
  return { ...BASE_NODE, styleId: style.id }
}

/** 按 id 取图元；寻不到直接失败，免得断言在 undefined 上空转 */
function primOf(style: Twin2dNodeStyle, id: string): Twin2dPrim {
  const found = style.prims.find((prim) => prim.id === id)
  if (found === undefined) throw new Error(`${style.id} 里没有图元 ${id}`)
  return found
}

/** 按 id 取一枚 vec 图元的几何 */
function shapeOf(style: Twin2dNodeStyle, id: string): Twin2dShape {
  const prim = primOf(style, id)
  if (prim.kind !== 'vec') throw new Error(`${style.id} 的 ${id} 不是 vec`)
  return prim.shape
}

/** 按 id 取端口 */
function portOf(style: Twin2dNodeStyle, id: string): Twin2dPort {
  const found = style.ports.find((port) => port.id === id)
  if (found === undefined) throw new Error(`${style.id} 里没有端口 ${id}`)
  return found
}

/** 一枚符号上某个端口的设计坐标 */
function at(style: Twin2dNodeStyle, portId: string): Xy | null {
  return portWorldPos(nodeOf(style), style, portId)
}

/** 一段直线几何的四个端点值 */
function lineOf(style: Twin2dNodeStyle, id: string): readonly number[] {
  const shape = shapeOf(style, id)
  if (shape.kind !== 'line') throw new Error(`${style.id} 的 ${id} 不是 line`)
  return [shape.x1, shape.y1, shape.x2, shape.y2]
}

describe('8 枚符号的身份', () => {
  it('文档序就是调色板的排序，8 枚一枚不多一枚不少', () => {
    expect(TWIN_2D_CIRCUIT_STYLES).toEqual([
      TWIN_2D_CIRCUIT_RESISTOR,
      TWIN_2D_CIRCUIT_CAPACITOR,
      TWIN_2D_CIRCUIT_INDUCTOR,
      TWIN_2D_CIRCUIT_DIODE,
      TWIN_2D_CIRCUIT_SWITCH,
      TWIN_2D_CIRCUIT_GROUND,
      TWIN_2D_CIRCUIT_SOURCE,
      TWIN_2D_CIRCUIT_JUNCTION,
    ])
  })

  it('id 各不相同且一律带 circuit- 引子', () => {
    const ids = TWIN_2D_CIRCUIT_STYLES.map((style) => style.id)
    expect(ids).toEqual([
      'circuit-resistor',
      'circuit-capacitor',
      'circuit-inductor',
      'circuit-diode',
      'circuit-switch',
      'circuit-ground',
      'circuit-source',
      'circuit-junction',
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('中文名逐枚对上 §6.2 那张表', () => {
    expect(TWIN_2D_CIRCUIT_STYLES.map((style) => style.name)).toEqual([
      '电阻',
      '电容',
      '电感',
      '二极管',
      '开关',
      '接地',
      '电源',
      '接线点',
    ])
  })

  it('分栏一律 circuit，且都不画状态点', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      expect(style.category).toBe('circuit')
      expect(style.defaultStatus).toBe('hidden')
    }
  })

  it('槽位与变体都是空的：这一族是几何符号，读数由标号与连线标签承担', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      expect(style.slots).toEqual([])
      expect(style.variants).toEqual([])
    }
  })

  it('图元 id 在每枚样式内唯一——重了节点级覆盖与变体补丁就寻错址', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      const ids = style.prims.map((prim) => prim.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('电阻', () => {
  const style = TWIN_2D_CIRCUIT_RESISTOR

  it('本体是空心矩形，长宽比恰好 4:1（GB/T 4728，不是折线锯齿形）', () => {
    const body = shapeOf(style, 'body')
    expect(body).toEqual({ kind: 'rect', x: 8, y: 7, w: 24, h: 6, rx: 0 })
    if (body.kind !== 'rect') throw new Error('本体不是 rect')
    expect(body.w / body.h).toBe(4)
  })

  it('本体不填充：空心是这一枚的全部要点', () => {
    const body = primOf(style, 'body')
    if (body.kind !== 'vec') throw new Error('本体不是 vec')
    expect(body.fill).toEqual({ kind: 'none' })
  })

  it('两段引线各自从盒边接到本体边', () => {
    expect(lineOf(style, 'lead-1')).toEqual([0, 10, 8, 10])
    expect(lineOf(style, 'lead-2')).toEqual([32, 10, 40, 10])
  })

  it('两个端口落在左右两边中点', () => {
    expect(style.size).toEqual({ w: 40, h: 20 })
    expect(at(style, '1')).toEqual({ x: 0, y: 10 })
    expect(at(style, '2')).toEqual({ x: 40, y: 10 })
  })
})

describe('电容', () => {
  const style = TWIN_2D_CIRCUIT_CAPACITOR

  it('两条极板等长、平行、间距 6', () => {
    expect(lineOf(style, 'plate-1')).toEqual([17, 3, 17, 17])
    expect(lineOf(style, 'plate-2')).toEqual([23, 3, 23, 17])
  })

  it('两段引线接到各自那块极板上', () => {
    expect(lineOf(style, 'lead-1')).toEqual([0, 10, 17, 10])
    expect(lineOf(style, 'lead-2')).toEqual([23, 10, 40, 10])
  })

  it('两个端口落在左右两边中点', () => {
    expect(at(style, '1')).toEqual({ x: 0, y: 10 })
    expect(at(style, '2')).toEqual({ x: 40, y: 10 })
  })
})

describe('电感', () => {
  const style = TWIN_2D_CIRCUIT_INDUCTOR

  it('本体是四个朝上的半圆弧，每个跨 6、半径 3', () => {
    const body = shapeOf(style, 'body')
    if (body.kind !== 'path') throw new Error('本体不是 path')
    expect(body.d).toBe(
      'M 8 10 A 3 3 0 0 1 14 10 A 3 3 0 0 1 20 10' +
        ' A 3 3 0 0 1 26 10 A 3 3 0 0 1 32 10',
    )
    // ⚠ y 轴朝下的 SVG 里，从左往右且 sweep=1 才是往上鼓；4 个 sweep 都得是 1
    expect(body.d.match(/0 1 /g)).toHaveLength(4)
  })

  it('四段弧首尾相接、总跨 24，两端各留 8 给引线', () => {
    expect(lineOf(style, 'lead-1')).toEqual([0, 10, 8, 10])
    expect(lineOf(style, 'lead-2')).toEqual([32, 10, 40, 10])
  })

  it('两个端口落在左右两边中点', () => {
    expect(at(style, '1')).toEqual({ x: 0, y: 10 })
    expect(at(style, '2')).toEqual({ x: 40, y: 10 })
  })
})

describe('二极管', () => {
  const style = TWIN_2D_CIRCUIT_DIODE

  it('实心三角指向阴极，尖端与阴极横杠同在 x=26', () => {
    expect(shapeOf(style, 'tri')).toEqual({
      kind: 'poly',
      points: [
        [14, 4],
        [14, 16],
        [26, 10],
      ],
      closed: true,
    })
    expect(lineOf(style, 'bar')).toEqual([26, 4, 26, 16])
  })

  it('三角是实心的：空心三角是另一族符号', () => {
    const tri = primOf(style, 'tri')
    if (tri.kind !== 'vec') throw new Error('三角不是 vec')
    expect(tri.fill).toEqual({ kind: 'color', color: 'var(--t2-accent)' })
  })

  it('两个端口方向有意义：阳极进、阴极出', () => {
    expect(portOf(style, 'a').name).toBe('A')
    expect(portOf(style, 'a').dir).toBe('in')
    expect(portOf(style, 'k').name).toBe('K')
    expect(portOf(style, 'k').dir).toBe('out')
  })

  it('阳极在左、阴极在右，与 transform.test.ts 那份样例同尺同位', () => {
    expect(style.size).toEqual({ w: 40, h: 20 })
    expect(at(style, 'a')).toEqual({ x: 0, y: 10 })
    expect(at(style, 'k')).toEqual({ x: 40, y: 10 })
  })
})

/** 两轴镜像的四种组合 */
type FlipCombo = '' | 'X' | 'Y' | 'XY'

/** 一组位姿与它该产出的两个落点：`a` 阳极、`k` 阴极 */
interface PoseCase {
  rot: Twin2dNodeRotation
  flip: FlipCombo
  a: readonly [number, number]
  k: readonly [number, number]
}

const FLIP_LABELS: Readonly<Record<FlipCombo, string>> = {
  '': '不镜像',
  X: '镜 X',
  Y: '镜 Y',
  XY: '镜 X+Y',
}

/**
 * 16 组期望值，与 tests/transform.test.ts 的那张表逐值同源：节点在 (100,50)、盒 40×20。
 * ⚠ 真正能分辨「先镜像后旋转」与「先旋转后镜像」的只有 rot ∈ {90, 270} 且**只镜一轴**
 * 那四组，其余十二组两种顺序数值一模一样。
 */
const POSE_CASES: readonly PoseCase[] = [
  { rot: 0, flip: '', a: [100, 60], k: [140, 60] },
  { rot: 90, flip: '', a: [120, 40], k: [120, 80] },
  { rot: 180, flip: '', a: [140, 60], k: [100, 60] },
  { rot: 270, flip: '', a: [120, 80], k: [120, 40] },
  { rot: 0, flip: 'X', a: [140, 60], k: [100, 60] },
  { rot: 90, flip: 'X', a: [120, 80], k: [120, 40] },
  { rot: 180, flip: 'X', a: [100, 60], k: [140, 60] },
  { rot: 270, flip: 'X', a: [120, 40], k: [120, 80] },
  { rot: 0, flip: 'Y', a: [100, 60], k: [140, 60] },
  { rot: 90, flip: 'Y', a: [120, 40], k: [120, 80] },
  { rot: 180, flip: 'Y', a: [140, 60], k: [100, 60] },
  { rot: 270, flip: 'Y', a: [120, 80], k: [120, 40] },
  { rot: 0, flip: 'XY', a: [140, 60], k: [100, 60] },
  { rot: 90, flip: 'XY', a: [120, 80], k: [120, 40] },
  { rot: 180, flip: 'XY', a: [100, 60], k: [140, 60] },
  { rot: 270, flip: 'XY', a: [120, 40], k: [120, 80] },
]

describe('二极管 4 档 rotate × 4 种 flip 的 16 组端口世界坐标', () => {
  const style = TWIN_2D_CIRCUIT_DIODE

  for (const one of POSE_CASES) {
    it(`rotate ${one.rot} + ${FLIP_LABELS[one.flip]}：阳极与阴极各落在自己那一头`, () => {
      const node: Twin2dNode = {
        ...BASE_NODE,
        styleId: style.id,
        x: 100,
        y: 50,
        w: 40,
        h: 20,
        rotate: one.rot,
        flipX: one.flip.includes('X'),
        flipY: one.flip.includes('Y'),
      }
      expect(portWorldPos(node, style, 'a')).toEqual({
        x: one.a[0],
        y: one.a[1],
      })
      expect(portWorldPos(node, style, 'k')).toEqual({
        x: one.k[0],
        y: one.k[1],
      })
    })
  }
})

describe('开关', () => {
  const style = TWIN_2D_CIRCUIT_SWITCH

  it('两个实心触点在两段引线的里端', () => {
    expect(shapeOf(style, 'pivot')).toEqual({
      kind: 'ellipse',
      cx: 12,
      cy: 10,
      rx: 1.5,
      ry: 1.5,
    })
    expect(shapeOf(style, 'contact')).toEqual({
      kind: 'ellipse',
      cx: 28,
      cy: 10,
      rx: 1.5,
      ry: 1.5,
    })
  })

  it('刀闸从转轴抬起、常态不搭到定触点上（画的是断开）', () => {
    const blade = lineOf(style, 'blade')
    expect(blade).toEqual([12, 10, 27, 3])
    expect(blade[0]).toBe(12)
    expect(blade[2]).toBeLessThan(28)
  })

  it('两个端口落在左右两边中点', () => {
    expect(at(style, '1')).toEqual({ x: 0, y: 10 })
    expect(at(style, '2')).toEqual({ x: 40, y: 10 })
  })
})

describe('接地', () => {
  const style = TWIN_2D_CIRCUIT_GROUND

  it('三横递减（GB/T 4728），不是实心三角', () => {
    const bars = ['bar-1', 'bar-2', 'bar-3'].map((id) => lineOf(style, id))
    const widths = bars.map((bar) => (bar[2] ?? 0) - (bar[0] ?? 0))
    expect(widths).toEqual([16, 10, 4])
    expect(bars.map((bar) => bar[1])).toEqual([10, 14, 18])
  })

  it('三横都居中对齐在竖引脚上', () => {
    for (const id of ['bar-1', 'bar-2', 'bar-3']) {
      const bar = lineOf(style, id)
      expect(((bar[0] ?? 0) + (bar[2] ?? 0)) / 2).toBe(12)
    }
  })

  it('一段竖引脚从顶边接到头一条横线', () => {
    expect(lineOf(style, 'lead')).toEqual([12, 0, 12, 10])
  })

  it('只有一个端口，落在顶边中点且朝上', () => {
    expect(style.ports).toHaveLength(1)
    expect(portOf(style, '1').name).toBe('GND')
    expect(at(style, '1')).toEqual({ x: 12, y: 0 })
    expect(portWorldSide(nodeOf(style), style, '1')).toBe('top')
  })
})

describe('电源', () => {
  const style = TWIN_2D_CIRCUIT_SOURCE

  it('本体是空心圆，两段引脚从上下两边接进来', () => {
    expect(shapeOf(style, 'body')).toEqual({
      kind: 'ellipse',
      cx: 16,
      cy: 20,
      rx: 12,
      ry: 12,
    })
    expect(lineOf(style, 'lead-p')).toEqual([16, 0, 16, 8])
    expect(lineOf(style, 'lead-n')).toEqual([16, 32, 16, 40])
  })

  it('极性号是两条等长交叉的 line，正好画成一个正号', () => {
    const horizontal = lineOf(style, 'plus-h')
    const vertical = lineOf(style, 'plus-v')
    expect(horizontal).toEqual([12, 14, 20, 14])
    expect(vertical).toEqual([16, 10, 16, 18])
    expect((horizontal[2] ?? 0) - (horizontal[0] ?? 0)).toBe(8)
    expect((vertical[3] ?? 0) - (vertical[1] ?? 0)).toBe(8)
  })

  it('正端在上、负端在下，两端方向相反', () => {
    expect(portOf(style, 'p').name).toBe('+')
    expect(portOf(style, 'p').dir).toBe('out')
    expect(portOf(style, 'n').name).toBe('−')
    expect(portOf(style, 'n').dir).toBe('in')
    expect(at(style, 'p')).toEqual({ x: 16, y: 0 })
    expect(at(style, 'n')).toEqual({ x: 16, y: 40 })
  })
})

describe('接线点', () => {
  const style = TWIN_2D_CIRCUIT_JUNCTION

  it('一个实心圆点，半径 3 且与盒同尺——导线才贴着圆周收口', () => {
    expect(style.size).toEqual({ w: 6, h: 6 })
    expect(shapeOf(style, 'dot')).toEqual({
      kind: 'ellipse',
      cx: 3,
      cy: 3,
      rx: 3,
      ry: 3,
    })
    const dot = primOf(style, 'dot')
    if (dot.kind !== 'vec') throw new Error('圆点不是 vec')
    expect(dot.fill).toEqual({ kind: 'color', color: 'var(--t2-accent)' })
  })

  it('四个 perim 端口落在四条边中点上', () => {
    expect(style.ports.map((port) => port.at)).toEqual([
      { kind: 'perim', t: 0.125 },
      { kind: 'perim', t: 0.375 },
      { kind: 'perim', t: 0.625 },
      { kind: 'perim', t: 0.875 },
    ])
    expect(at(style, 't')).toEqual({ x: 3, y: 0 })
    expect(at(style, 'r')).toEqual({ x: 6, y: 3 })
    expect(at(style, 'b')).toEqual({ x: 3, y: 6 })
    expect(at(style, 'l')).toEqual({ x: 0, y: 3 })
  })

  it('四个端口的出线方向各朝一边，且都是双向的', () => {
    const node = nodeOf(style)
    expect(portWorldSide(node, style, 't')).toBe('top')
    expect(portWorldSide(node, style, 'r')).toBe('right')
    expect(portWorldSide(node, style, 'b')).toBe('bottom')
    expect(portWorldSide(node, style, 'l')).toBe('left')
    for (const port of style.ports) expect(port.dir).toBe('both')
  })

  it('四个端口都不带引脚：汇合点没有引脚可画', () => {
    for (const port of style.ports) expect(port.marker).toBeNull()
  })
})

describe('引脚 marker', () => {
  /** 除接线点以外的 7 枚都带引脚 */
  const withPins = TWIN_2D_CIRCUIT_STYLES.filter(
    (style) => style.id !== 'circuit-junction',
  )

  it('7 枚符号的每个端口都挂着引脚', () => {
    expect(withPins).toHaveLength(7)
    for (const style of withPins) {
      for (const port of style.ports) expect(port.marker).not.toBeNull()
    }
  })

  it('引脚是从端口点沿出线方向伸出的一段短横线，y 恒 0', () => {
    for (const style of withPins) {
      for (const port of style.ports) {
        expect(port.marker?.shape).toEqual({
          kind: 'line',
          x1: 0,
          y1: 0,
          x2: 1,
          y2: 0,
        })
        expect(port.marker?.length).toBe(8)
      }
    }
  })

  it('引脚带线宽——只给 shape 会让引脚落到 SVG 缺省的 1px', () => {
    for (const style of withPins) {
      for (const port of style.ports) {
        expect(port.marker?.strokes).toEqual([
          {
            id: 'pin',
            width: 1.5,
            color: 'var(--text-primary)',
            dash: [],
            cap: 'butt',
            join: 'miter',
            opacity: 1,
            nonScaling: false,
          },
        ])
      }
    }
  })

  it('引脚不填充：它是一根线，不是一个面', () => {
    for (const style of withPins) {
      for (const port of style.ports) {
        expect(port.marker?.fill).toEqual({ kind: 'none' })
      }
    }
  })

  it('引脚取色不能用 --t2-accent：连线层读不到节点根上那六个变量', () => {
    for (const style of withPins) {
      for (const port of style.ports) {
        for (const pass of port.marker?.strokes ?? []) {
          expect(pass.color).not.toContain('--t2-')
        }
      }
    }
  })
})

describe('元件标号', () => {
  it('8 枚各带一枚正立标号，读的是节点实例的 label', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      const ref = primOf(style, 'ref')
      expect(ref.kind).toBe('txt')
      if (ref.kind !== 'txt') throw new Error('标号不是 txt')
      expect(ref.src).toEqual({ kind: 'label' })
      expect(ref.keepUpright).toBe(true)
    }
  })

  it('标号是每枚样式里唯一的 txt', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      const texts = style.prims.filter((prim) => prim.kind === 'txt')
      expect(texts.map((prim) => prim.id)).toEqual(['ref'])
    }
  })

  it('引脚朝上下的两枚把标号贴到右侧，免得压在引脚上', () => {
    for (const style of [TWIN_2D_CIRCUIT_GROUND, TWIN_2D_CIRCUIT_SOURCE]) {
      expect(primOf(style, 'ref').at).toEqual({
        kind: 'anchor',
        anchor: 'r',
        dx: 0,
        dy: 0,
      })
    }
  })

  it('横排元件把标号贴到上方', () => {
    for (const style of [
      TWIN_2D_CIRCUIT_RESISTOR,
      TWIN_2D_CIRCUIT_CAPACITOR,
      TWIN_2D_CIRCUIT_INDUCTOR,
      TWIN_2D_CIRCUIT_DIODE,
      TWIN_2D_CIRCUIT_SWITCH,
    ]) {
      expect(primOf(style, 'ref').at).toEqual({
        kind: 'anchor',
        anchor: 't',
        dx: 0,
        dy: 0,
      })
    }
  })

  it('符号本体一律不吃指针，命中判定归节点根', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      for (const prim of style.prims) {
        expect(prim.pointerEvents).toBe('none')
      }
    }
  })
})

describe('8 枚只用 vec 与 txt 两种图元 kind', () => {
  it('任意符号几何都不需要新增图元档——这一条守着「预置库是数据不是渲染分支」', () => {
    const kinds = new Set(
      TWIN_2D_CIRCUIT_STYLES.flatMap((style) =>
        style.prims.map((prim) => prim.kind),
      ),
    )
    expect([...kinds].sort()).toEqual(['txt', 'vec'])
  })

  it('一个 box 都没有，所以图元树只有一层、没有子树要递归', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      for (const prim of style.prims) {
        expect(prim.kind).not.toBe('box')
        expect(prim.kind).not.toBe('ico')
      }
    }
  })

  it('实心图元一律不描边——同色描边会把形状往外撑半个线宽', () => {
    const solids: readonly (readonly [Twin2dNodeStyle, string])[] = [
      [TWIN_2D_CIRCUIT_DIODE, 'tri'],
      [TWIN_2D_CIRCUIT_SWITCH, 'pivot'],
      [TWIN_2D_CIRCUIT_SWITCH, 'contact'],
      [TWIN_2D_CIRCUIT_JUNCTION, 'dot'],
    ]
    for (const [style, id] of solids) {
      const prim = primOf(style, id)
      if (prim.kind !== 'vec') throw new Error(`${id} 不是 vec`)
      expect(prim.fill).toEqual({ kind: 'color', color: 'var(--t2-accent)' })
      expect(prim.strokes).toEqual([])
    }
  })

  it('描边的那几件线宽一律 1.5，符号本体与引脚同宽', () => {
    const passes = TWIN_2D_CIRCUIT_STYLES.flatMap((style) =>
      style.prims.flatMap((prim) => (prim.kind === 'vec' ? prim.strokes : [])),
    )
    expect(passes.length).toBeGreaterThan(0)
    for (const pass of passes) {
      expect(pass.width).toBe(1.5)
      expect(pass.color).toBe('var(--t2-accent)')
    }
  })

  it('全部几何按设计像素给，与样式 size 是同一把尺子', () => {
    for (const style of TWIN_2D_CIRCUIT_STYLES) {
      for (const prim of style.prims) {
        if (prim.kind !== 'vec') continue
        expect(prim.coord).toBe('px')
        expect(prim.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
      }
    }
  })

  it('五种几何里本族用到了四种，只有 rect 各一处', () => {
    const shapes = TWIN_2D_CIRCUIT_STYLES.flatMap((style) =>
      style.prims.flatMap((prim) => (prim.kind === 'vec' ? [prim.shape] : [])),
    )
    const kinds = shapes.map((shape) => shape.kind)
    expect(new Set(kinds)).toEqual(
      new Set(['line', 'rect', 'ellipse', 'path', 'poly']),
    )
    expect(kinds.filter((kind) => kind === 'rect')).toHaveLength(1)
  })
})
