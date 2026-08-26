/**
 * @fileoverview 锁住节点位姿的复合顺序：先镜像 → 再旋转 → 最后平移。用一枚二极管
 * （非对称符号、阳极在左阴极在右）把 4 档 rotate × 4 种 flip 的 16 组端口坐标逐组钉死，
 * 另锁左上角 ↔ 中心盒换算、周长参数化的反向两段、端口朝向跟转、keepUpright 的反向角。
 * ⚠ 顺序反了在对称符号上肉眼看不出来，在二极管上就是极性反了——图画得挺好，接线是错的。
 */
import { describe, expect, it } from 'vitest'

import {
  applyNodeTransform,
  centerBoxOf,
  invertNodeTransform,
  keepUprightCss,
  nodeTransformCss,
  portWorldPos,
  portWorldSide,
} from '../src/transform'
import type { Twin2dNodeRotation, Twin2dPortSide } from '../src/kinds'
import type {
  Twin2dNode,
  Twin2dNodeSize,
  Twin2dNodeStyle,
  Twin2dPort,
  Twin2dPortAt,
} from '../src/types'

/** 一个二维点；本文件不依赖 geometry，免得两个并行文件互相等 */
interface Xy {
  x: number
  y: number
}

/** 二极管符号的设计尺寸 */
const DIODE_SIZE: Twin2dNodeSize = { w: 40, h: 20 }

/** 二极管三角尖在未变换时的画布坐标（相对盒心 -12/-6，两轴都偏） */
const APEX_LOCAL: Xy = { x: 108, y: 54 }

const BASE_NODE: Twin2dNode = {
  id: 'd1',
  styleId: 'circuit-diode',
  x: 100,
  y: 50,
  w: 40,
  h: 20,
  rotate: 0,
  flipX: false,
  flipY: false,
  label: '',
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

function makePort(
  id: string,
  at: Twin2dPortAt,
  side: Twin2dPortSide,
): Twin2dPort {
  return {
    id,
    name: id,
    at,
    dir: 'passive',
    side,
    showName: false,
    marker: null,
  }
}

function makeStyle(
  ports: readonly Twin2dPort[],
  size: Twin2dNodeSize = DIODE_SIZE,
): Twin2dNodeStyle {
  return {
    id: 'circuit-diode',
    name: '二极管',
    category: 'circuit',
    accent: 'var(--accent-primary)',
    defaultStatus: 'hidden',
    size,
    prims: [],
    ports,
    slots: [],
    variants: [],
  }
}

function makeNode(over: Partial<Twin2dNode>): Twin2dNode {
  return { ...BASE_NODE, ...over }
}

/** 阳极走 xy 落点、阴极走周长参数，两种 `at` 各锁一路 */
const DIODE_PORTS: readonly Twin2dPort[] = [
  makePort('a', { kind: 'xy', x: 0, y: 0.5 }, 'left'),
  makePort('k', { kind: 'perim', t: 0.375 }, 'right'),
]

const DIODE_STYLE = makeStyle(DIODE_PORTS)

/** 两轴镜像的四种组合 */
type FlipCombo = '' | 'X' | 'Y' | 'XY'

/** 一组位姿与它该产出的三个落点：`a` 阳极、`k` 阴极、`apex` 三角尖 */
interface PoseCase {
  rot: Twin2dNodeRotation
  flip: FlipCombo
  a: readonly [number, number]
  k: readonly [number, number]
  apex: readonly [number, number]
}

const FLIP_LABELS: Readonly<Record<FlipCombo, string>> = {
  '': '不镜像',
  X: '镜 X',
  Y: '镜 Y',
  XY: '镜 X+Y',
}

/**
 * 16 组期望值。
 * ⚠ 真正能分辨「先镜像后旋转」与「先旋转后镜像」的只有 rot ∈ {90, 270} 且**只镜一轴**
 * 那四组：rot 0/180 与「两轴都镜/都不镜」下两种顺序的矩阵可交换，数值一模一样。
 * 删掉那四组这张表就白摆了。
 */
const POSE_CASES: readonly PoseCase[] = [
  { rot: 0, flip: '', a: [100, 60], k: [140, 60], apex: [108, 54] },
  { rot: 90, flip: '', a: [120, 40], k: [120, 80], apex: [126, 48] },
  { rot: 180, flip: '', a: [140, 60], k: [100, 60], apex: [132, 66] },
  { rot: 270, flip: '', a: [120, 80], k: [120, 40], apex: [114, 72] },
  { rot: 0, flip: 'X', a: [140, 60], k: [100, 60], apex: [132, 54] },
  { rot: 90, flip: 'X', a: [120, 80], k: [120, 40], apex: [126, 72] },
  { rot: 180, flip: 'X', a: [100, 60], k: [140, 60], apex: [108, 66] },
  { rot: 270, flip: 'X', a: [120, 40], k: [120, 80], apex: [114, 48] },
  { rot: 0, flip: 'Y', a: [100, 60], k: [140, 60], apex: [108, 66] },
  { rot: 90, flip: 'Y', a: [120, 40], k: [120, 80], apex: [114, 48] },
  { rot: 180, flip: 'Y', a: [140, 60], k: [100, 60], apex: [132, 54] },
  { rot: 270, flip: 'Y', a: [120, 80], k: [120, 40], apex: [126, 72] },
  { rot: 0, flip: 'XY', a: [140, 60], k: [100, 60], apex: [132, 66] },
  { rot: 90, flip: 'XY', a: [120, 80], k: [120, 40], apex: [114, 72] },
  { rot: 180, flip: 'XY', a: [100, 60], k: [140, 60], apex: [108, 54] },
  { rot: 270, flip: 'XY', a: [120, 40], k: [120, 80], apex: [126, 48] },
]

function pt(pair: readonly [number, number]): Xy {
  return { x: pair[0], y: pair[1] }
}

function caseLabel(one: PoseCase): string {
  return `rotate ${one.rot} + ${FLIP_LABELS[one.flip]}`
}

function caseNode(one: PoseCase): Twin2dNode {
  return makeNode({
    rotate: one.rot,
    flipX: one.flip.includes('X'),
    flipY: one.flip.includes('Y'),
  })
}

describe('centerBoxOf', () => {
  it('左上角 + 宽高 换算成以中心为参考的盒', () => {
    expect(centerBoxOf(BASE_NODE, { w: 160, h: 90 })).toEqual({
      x: 120,
      y: 60,
      w: 40,
      h: 20,
    })
  })

  it('宽是 0 时跟样式的 size 走，0 是哨兵不是真尺寸', () => {
    const node = makeNode({ w: 0 })
    expect(centerBoxOf(node, { w: 160, h: 90 })).toEqual({
      x: 180,
      y: 60,
      w: 160,
      h: 20,
    })
  })

  it('高是 0 时同样回落到样式的 size，两条边各判各的', () => {
    const node = makeNode({ h: 0 })
    expect(centerBoxOf(node, { w: 160, h: 90 })).toEqual({
      x: 120,
      y: 95,
      w: 40,
      h: 90,
    })
  })

  it('坐标为负不夹取——图往左上扩是常事', () => {
    const node = makeNode({ x: -30, y: -10 })
    expect(centerBoxOf(node, DIODE_SIZE)).toEqual({
      x: -10,
      y: 0,
      w: 40,
      h: 20,
    })
  })
})

describe('nodeTransformCss', () => {
  it('三段的先后写死 translate → rotate → scale', () => {
    expect(nodeTransformCss(BASE_NODE)).toBe(
      'translate(100px, 50px) rotate(0deg) scale(1, 1)',
    )
  })

  it('镜 X 落在 scale 的第一个因子上', () => {
    const node = makeNode({ rotate: 270, flipX: true })
    expect(nodeTransformCss(node)).toBe(
      'translate(100px, 50px) rotate(270deg) scale(-1, 1)',
    )
  })

  it('镜 Y 落在 scale 的第二个因子上', () => {
    const node = makeNode({ rotate: 90, flipY: true })
    expect(nodeTransformCss(node)).toBe(
      'translate(100px, 50px) rotate(90deg) scale(1, -1)',
    )
  })
})

describe('二极管 4 档 rotate × 4 种 flip 的 16 组端口坐标', () => {
  for (const one of POSE_CASES) {
    it(`${caseLabel(one)}：阳极与阴极各落在自己那一头`, () => {
      const node = caseNode(one)
      expect(portWorldPos(node, DIODE_STYLE, 'a')).toEqual(pt(one.a))
      expect(portWorldPos(node, DIODE_STYLE, 'k')).toEqual(pt(one.k))
    })
  }
})

describe('applyNodeTransform 与 invertNodeTransform', () => {
  for (const one of POSE_CASES) {
    it(`${caseLabel(one)}：三角尖的正向落点与往返一致`, () => {
      const node = caseNode(one)
      // ⚠ 只断往返一致锁不住任何东西——两个函数都写成恒等也往返一致，所以先断正向值
      expect(applyNodeTransform(APEX_LOCAL, node, DIODE_SIZE)).toEqual(
        pt(one.apex),
      )
      expect(invertNodeTransform(pt(one.apex), node, DIODE_SIZE)).toEqual(
        APEX_LOCAL,
      )
    })
  }

  it('节点没给尺寸时两个方向都按样式的 size 换算', () => {
    const node = makeNode({ x: 0, y: 0, w: 0, h: 0, rotate: 90 })
    const world = applyNodeTransform({ x: 8, y: 4 }, node, DIODE_SIZE)
    expect(world).toEqual({ x: 26, y: -2 })
    expect(invertNodeTransform(world, node, DIODE_SIZE)).toEqual({ x: 8, y: 4 })
  })
})

describe('portWorldPos 走的是几何层那一套周长参数化', () => {
  function at(t: number): Xy | null {
    const style = makeStyle([makePort('p', { kind: 'perim', t }, 'auto')])
    return portWorldPos(BASE_NODE, style, 'p')
  }

  it('四个角点是精确值：原点在左上角、顺时针', () => {
    expect(at(0)).toEqual({ x: 100, y: 50 })
    expect(at(0.25)).toEqual({ x: 140, y: 50 })
    expect(at(0.5)).toEqual({ x: 140, y: 70 })
    expect(at(0.75)).toEqual({ x: 100, y: 70 })
  })

  it('四条边的中点对应 0.125 / 0.375 / 0.625 / 0.875', () => {
    expect(at(0.125)).toEqual({ x: 120, y: 50 })
    expect(at(0.375)).toEqual({ x: 140, y: 60 })
    expect(at(0.625)).toEqual({ x: 120, y: 70 })
    expect(at(0.875)).toEqual({ x: 100, y: 60 })
  })

  it('下边与左边是反向参数化的，写成正向只有这两段悄悄镜像', () => {
    // 正向写法会给出 (110, 70) 与 (100, 65)，其余两段仍然全对
    expect(at(0.5625)).toEqual({ x: 130, y: 70 })
    expect(at(0.9375)).toEqual({ x: 100, y: 55 })
  })

  it('越界与非有限的 t 由几何层折进 [0,1)，这里不另收一遍', () => {
    expect(at(1.5)).toEqual({ x: 140, y: 70 })
    expect(at(Number.NaN)).toEqual({ x: 100, y: 50 })
  })
})

describe('portWorldPos 的端口解析', () => {
  it('端口 id 查不到回 null，调用方按「这条线挂不上」处理', () => {
    expect(portWorldPos(BASE_NODE, DIODE_STYLE, 'zz')).toBeNull()
  })

  it('样式一个端口都没有时也回 null', () => {
    expect(portWorldPos(BASE_NODE, makeStyle([]), 'a')).toBeNull()
  })

  it('节点上的同 id 端口覆盖样式里的那一个', () => {
    const node = makeNode({
      ports: [makePort('a', { kind: 'perim', t: 0.125 }, 'top')],
    })
    expect(portWorldPos(node, DIODE_STYLE, 'a')).toEqual({ x: 120, y: 50 })
  })
})

describe('portWorldSide', () => {
  const sideStyle = makeStyle([
    makePort('t', { kind: 'perim', t: 0.125 }, 'top'),
    makePort('r', { kind: 'perim', t: 0.375 }, 'right'),
    makePort('b', { kind: 'perim', t: 0.625 }, 'bottom'),
    makePort('l', { kind: 'perim', t: 0.875 }, 'left'),
  ])

  it('不转不镜时四档朝向原样返回', () => {
    expect(portWorldSide(BASE_NODE, sideStyle, 't')).toBe('top')
    expect(portWorldSide(BASE_NODE, sideStyle, 'r')).toBe('right')
    expect(portWorldSide(BASE_NODE, sideStyle, 'b')).toBe('bottom')
    expect(portWorldSide(BASE_NODE, sideStyle, 'l')).toBe('left')
  })

  it('转 90 度时左端口朝上，四档整体顺时针挪一格', () => {
    const node = makeNode({ rotate: 90 })
    expect(portWorldSide(node, sideStyle, 'l')).toBe('top')
    expect(portWorldSide(node, sideStyle, 't')).toBe('right')
    expect(portWorldSide(node, sideStyle, 'r')).toBe('bottom')
    expect(portWorldSide(node, sideStyle, 'b')).toBe('left')
  })

  it('镜 X 时左右互换、上下不动', () => {
    const node = makeNode({ flipX: true })
    expect(portWorldSide(node, sideStyle, 'l')).toBe('right')
    expect(portWorldSide(node, sideStyle, 'r')).toBe('left')
    expect(portWorldSide(node, sideStyle, 't')).toBe('top')
  })

  it('镜 Y 时上下互换、左右不动', () => {
    const node = makeNode({ flipY: true })
    expect(portWorldSide(node, sideStyle, 't')).toBe('bottom')
    expect(portWorldSide(node, sideStyle, 'b')).toBe('top')
    expect(portWorldSide(node, sideStyle, 'l')).toBe('left')
  })

  it('端口查不到时回优先序的头一档——路由只吃四档，没有「没有」', () => {
    expect(portWorldSide(BASE_NODE, sideStyle, 'zz')).toBe('top')
  })
})

describe('portWorldSide 的 auto 解析', () => {
  function sideOf(at: Twin2dPortAt, node: Twin2dNode = BASE_NODE): string {
    return portWorldSide(node, makeStyle([makePort('p', at, 'auto')]), 'p')
  }

  it('perim 的 t 落在哪一段就朝哪一档', () => {
    expect(sideOf({ kind: 'perim', t: 0.1 })).toBe('top')
    expect(sideOf({ kind: 'perim', t: 0.3 })).toBe('right')
    expect(sideOf({ kind: 'perim', t: 0.6 })).toBe('bottom')
    expect(sideOf({ kind: 'perim', t: 0.9 })).toBe('left')
  })

  it('xy 按到四条边的最近边推', () => {
    expect(sideOf({ kind: 'xy', x: 0.5, y: 0.05 })).toBe('top')
    expect(sideOf({ kind: 'xy', x: 0.95, y: 0.5 })).toBe('right')
    expect(sideOf({ kind: 'xy', x: 0.5, y: 0.95 })).toBe('bottom')
    expect(sideOf({ kind: 'xy', x: 0.05, y: 0.5 })).toBe('left')
  })

  it('并列时取 TWIN_2D_SIDE_PRIORITY 里靠前的一档', () => {
    expect(sideOf({ kind: 'xy', x: 0.5, y: 0.5 })).toBe('top')
  })

  it('判最近边用的是节点的真实盒——盒没传进去、或没回落到样式 size 就会判错', () => {
    const node = makeNode({ x: 0, y: 0, w: 0, h: 0 })
    const style = makeStyle(
      [makePort('p', { kind: 'xy', x: 0.3, y: 0.4 }, 'auto')],
      {
        w: 200,
        h: 50,
      },
    )
    // 200×50 的盒上到上边是 20px、到左边是 60px；按归一值或单位盒判都会得出 left
    expect(portWorldSide(node, style, 'p')).toBe('top')
  })

  it('auto 解析出来的朝向照样跟着旋转转', () => {
    const node = makeNode({ rotate: 90 })
    expect(sideOf({ kind: 'xy', x: 0.05, y: 0.5 }, node)).toBe('top')
  })
})

describe('keepUprightCss', () => {
  it('节点转 90 度时该图元的反向角是 -90', () => {
    expect(keepUprightCss(makeNode({ rotate: 90 }))).toBe(
      'scale(1, 1) rotate(-90deg)',
    )
  })

  it('既不转也不镜时没有要撤的，回 none', () => {
    expect(keepUprightCss(BASE_NODE)).toBe('none')
  })

  it('只镜 X 时也要撤，否则标号是反着的', () => {
    expect(keepUprightCss(makeNode({ flipX: true }))).toBe(
      'scale(-1, 1) rotate(0deg)',
    )
  })

  it('只镜 Y 时同样要撤', () => {
    expect(keepUprightCss(makeNode({ flipY: true }))).toBe(
      'scale(1, -1) rotate(0deg)',
    )
  })

  it('转 180 又两轴都镜时旋转与镜像各撤各的', () => {
    const node = makeNode({ rotate: 180, flipX: true, flipY: true })
    expect(keepUprightCss(node)).toBe('scale(-1, -1) rotate(-180deg)')
  })
})
