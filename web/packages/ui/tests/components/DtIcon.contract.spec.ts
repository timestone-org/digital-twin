/**
 * @fileoverview 锁住图标注册契约：名字都登记过，图形都画在视框内。
 * ⚠ 传给 DtIcon 一个未登记的名字，typecheck 与 lint 双双放行、控制台无声，
 * 图标位置只是空着；画出视框的路径同样无声，只是边缘被裁掉一条。
 * 这个文件是两者唯一的防线。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DtIcon from '../../src/components/DtIcon/DtIcon.vue'
import { ICONS, isIconName } from '../../src/components/DtIcon/registry'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WORKSPACE = process.cwd()
const SEARCH_ROOTS = ['app/src', 'packages']
// 只收字面量 name；`:name="expr"` 是绑定，取值在运行时才知道，扫不到也不该扫
const NAME_PATTERN = /(?<![:\w-])name="([a-z0-9-]+)"/g

function collectVueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...collectVueFiles(full))
    } else if (entry.endsWith('.vue')) {
      found.push(full)
    }
  }
  return found
}

/** 扫出模板里所有 `<DtIcon name="...">` 的字面量名字。 */
function usedIconNames(): Map<string, string[]> {
  const usage = new Map<string, string[]>()
  for (const root of SEARCH_ROOTS) {
    for (const file of collectVueFiles(join(WORKSPACE, root))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<DtIcon\b[^>]*>/g)) {
        for (const name of match[0].matchAll(NAME_PATTERN)) {
          const key = name[1] as string
          usage.set(key, [...(usage.get(key) ?? []), file])
        }
      }
    }
  }
  return usage
}

describe('图标注册表', () => {
  it('模板里用到的每个字面量名字都已登记', () => {
    const unregistered = [...usedIconNames().entries()].filter(
      ([name]) => !isIconName(name),
    )
    expect(unregistered).toEqual([])
  })

  it('每个图标至少有一条路径', () => {
    for (const [name, paths] of Object.entries(ICONS)) {
      expect(paths.length, name).toBeGreaterThan(0)
    }
  })
})

describe('DtIcon', () => {
  it('登记过的名字渲染出对应数量的 path', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user' } })
    expect(wrapper.findAll('path')).toHaveLength(ICONS.user.length)
  })

  it('未登记的名字什么都不渲染，也不抛错', () => {
    const wrapper = mount(DtIcon, { props: { name: 'no-such-icon' } })
    expect(wrapper.find('svg').exists()).toBe(false)
  })

  it('尺寸落到 width / height 上', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user', size: 32 } })
    expect(wrapper.find('svg').attributes('width')).toBe('32')
  })

  it('非法尺寸回退默认值而不是产出 NaN', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user', size: Number.NaN } })
    expect(wrapper.find('svg').attributes('width')).toBe('18')
  })

  it('图标对读屏隐藏：它是装饰，名称由承载它的控件给', () => {
    const wrapper = mount(DtIcon, { props: { name: 'user' } })
    expect(wrapper.find('svg').attributes('aria-hidden')).toBe('true')
  })
})

// 与 DtIcon 模板上的 viewBox / stroke-width 同值；改那边要一起改这里
const VIEW_BOX = 24
const STROKE_WIDTH = 2
// 圆弧按等角步长采样。整圆半径 6 时 64 步的取样误差约 0.007，远小于一个像素
const ARC_STEPS = 64
const CURVE_STEPS = 32

type Point = readonly [number, number]

interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** 画笔：当前点、当前子路径起点，以及上一段三次曲线的第二控制点（S 要镜像它）。 */
interface Pen {
  x: number
  y: number
  subpathX: number
  subpathY: number
  reflectX: number
  reflectY: number
}

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, A: 7, Z: 0 } as const
type Command = keyof typeof ARITY
type Drawable = Exclude<Command, 'Z'>

// 相对命令里哪一位要加当前点的 x、哪一位加 y；'-' 是半径/标志位这类不带坐标的
const AXES: Record<Command, readonly ('x' | 'y' | '-')[]> = {
  M: ['x', 'y'],
  L: ['x', 'y'],
  H: ['x'],
  V: ['y'],
  C: ['x', 'y', 'x', 'y', 'x', 'y'],
  S: ['x', 'y', 'x', 'y'],
  A: ['-', '-', '-', '-', '-', 'x', 'y'],
  Z: [],
}

const TOKEN = /([A-Za-z])([^A-Za-z]*)/g
const NUMBER = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g

function isCommand(value: string): value is Command {
  return Object.hasOwn(ARITY, value)
}

/** 缺参说明路径串本身写坏了，炸掉而不是当 0 混过去。 */
function arg(args: readonly number[], index: number): number {
  const value = args[index]
  if (value === undefined) throw new Error(`路径参数缺失 #${index}`)
  return value
}

function movePen(pen: Pen, x: number, y: number): Point[] {
  pen.x = x
  pen.y = y
  pen.reflectX = x
  pen.reflectY = y
  return [[x, y]]
}

function moveTo(pen: Pen, args: readonly number[]): Point[] {
  pen.subpathX = arg(args, 0)
  pen.subpathY = arg(args, 1)
  return movePen(pen, arg(args, 0), arg(args, 1))
}

function closePath(pen: Pen): Point[] {
  return movePen(pen, pen.subpathX, pen.subpathY)
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const points: Point[] = []
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS
    const u = 1 - t
    const [a, b, c, d] = [u ** 3, 3 * u * u * t, 3 * u * t * t, t ** 3]
    points.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ])
  }
  return points
}

function cubicTo(pen: Pen, args: readonly number[]): Point[] {
  const points = sampleCubic(
    [pen.x, pen.y],
    [arg(args, 0), arg(args, 1)],
    [arg(args, 2), arg(args, 3)],
    [arg(args, 4), arg(args, 5)],
  )
  movePen(pen, arg(args, 4), arg(args, 5))
  pen.reflectX = arg(args, 2)
  pen.reflectY = arg(args, 3)
  return points
}

/** S 的第一控制点 = 上一段第二控制点关于当前点的镜像；前一段不是曲线时就是当前点。 */
function smoothCubicTo(pen: Pen, args: readonly number[]): Point[] {
  return cubicTo(pen, [
    2 * pen.x - pen.reflectX,
    2 * pen.y - pen.reflectY,
    arg(args, 0),
    arg(args, 1),
    arg(args, 2),
    arg(args, 3),
  ])
}

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy)
  const cosine = Math.min(1, Math.max(-1, (ux * vx + uy * vy) / scale))
  return (ux * vy - uy * vx < 0 ? -1 : 1) * Math.acos(cosine)
}

interface Arc {
  cx: number
  cy: number
  rx: number
  ry: number
  rotation: number
  theta: number
  delta: number
}

/** 端点式圆弧换算成圆心式，照 SVG 规范 F.6.5。半径为 0 时规范要求当直线画。 */
function arcParams(from: Point, args: readonly number[]): Arc | null {
  let rx = Math.abs(arg(args, 0))
  let ry = Math.abs(arg(args, 1))
  if (rx === 0 || ry === 0) return null
  const rotation = (arg(args, 2) * Math.PI) / 180
  const largeArc = arg(args, 3) !== 0
  const sweep = arg(args, 4) !== 0
  const [cos, sin] = [Math.cos(rotation), Math.sin(rotation)]
  const dx = (from[0] - arg(args, 5)) / 2
  const dy = (from[1] - arg(args, 6)) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const overshoot = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (overshoot > 1) {
    const grow = Math.sqrt(overshoot)
    rx *= grow
    ry *= grow
  }
  const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const numerator = Math.max(rx * rx * ry * ry - denominator, 0)
  const factor =
    (largeArc === sweep ? -1 : 1) * Math.sqrt(numerator / denominator)
  const cx1 = (factor * rx * y1) / ry
  const cy1 = (-factor * ry * x1) / rx
  const [ux, uy] = [(x1 - cx1) / rx, (y1 - cy1) / ry]
  const [vx, vy] = [(-x1 - cx1) / rx, (-y1 - cy1) / ry]
  const spanned = angleBetween(ux, uy, vx, vy)
  const turn = 2 * Math.PI
  return {
    cx: cos * cx1 - sin * cy1 + (from[0] + arg(args, 5)) / 2,
    cy: sin * cx1 + cos * cy1 + (from[1] + arg(args, 6)) / 2,
    rx,
    ry,
    rotation,
    theta: angleBetween(1, 0, ux, uy),
    delta: sweep ? mod(spanned, turn) : mod(spanned, turn) - turn,
  }
}

/** 取正余数：JS 的 % 会跟着被除数带符号，直接用会把弧扫向反面。 */
function mod(value: number, span: number): number {
  return ((value % span) + span) % span
}

function arcTo(pen: Pen, args: readonly number[]): Point[] {
  const arc = arcParams([pen.x, pen.y], args)
  const end = movePen(pen, arg(args, 5), arg(args, 6))
  if (arc === null) return end
  const points: Point[] = []
  for (let step = 1; step <= ARC_STEPS; step += 1) {
    const angle = arc.theta + (arc.delta * step) / ARC_STEPS
    const [ax, ay] = [arc.rx * Math.cos(angle), arc.ry * Math.sin(angle)]
    points.push([
      Math.cos(arc.rotation) * ax - Math.sin(arc.rotation) * ay + arc.cx,
      Math.sin(arc.rotation) * ax + Math.cos(arc.rotation) * ay + arc.cy,
    ])
  }
  return points
}

const DRAW: Record<Drawable, (pen: Pen, args: readonly number[]) => Point[]> = {
  M: moveTo,
  L: (pen, args) => movePen(pen, arg(args, 0), arg(args, 1)),
  H: (pen, args) => movePen(pen, arg(args, 0), pen.y),
  V: (pen, args) => movePen(pen, pen.x, arg(args, 0)),
  C: cubicTo,
  S: smoothCubicTo,
  A: arcTo,
}

function absolutize(
  command: Command,
  args: readonly number[],
  pen: Pen,
): number[] {
  return args.map((value, index) => {
    const axis = AXES[command][index]
    if (axis === 'x') return value + pen.x
    if (axis === 'y') return value + pen.y
    return value
  })
}

/** 一条命令可以带好几组参数；M 的第二组起按 L 画，这是 SVG 的隐式重复规则。 */
function runCommand(letter: string, args: number[], pen: Pen): Point[] {
  const command = letter.toUpperCase()
  if (!isCommand(command)) throw new Error(`不支持的路径命令 ${letter}`)
  if (command === 'Z') return closePath(pen)
  const relative = letter !== command
  const points: Point[] = []
  for (let index = 0; index < args.length; index += ARITY[command]) {
    const group: Drawable = command === 'M' && index > 0 ? 'L' : command
    const chunk = args.slice(index, index + ARITY[command])
    points.push(
      ...DRAW[group](pen, relative ? absolutize(group, chunk, pen) : chunk),
    )
  }
  return points
}

function flatten(d: string): Point[] {
  const pen: Pen = {
    x: 0,
    y: 0,
    subpathX: 0,
    subpathY: 0,
    reflectX: 0,
    reflectY: 0,
  }
  const points: Point[] = []
  for (const [, letter = '', rest = ''] of d.matchAll(TOKEN)) {
    const args = [...rest.matchAll(NUMBER)].map((match) => Number(match[0]))
    points.push(...runCommand(letter, args, pen))
  }
  return points
}

/**
 * 一组路径实际着墨的范围。圆角端点与圆角连接让描边正好是几何外扩半个线宽，
 * 所以极值加减 1 就是精确值，不是估算。
 */
function inkBounds(paths: readonly string[]): Bounds {
  const points = paths.flatMap(flatten)
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const half = STROKE_WIDTH / 2
  return {
    minX: Math.min(...xs) - half,
    minY: Math.min(...ys) - half,
    maxX: Math.max(...xs) + half,
    maxY: Math.max(...ys) + half,
  }
}

/** 越出视框的边与越出多少；没越出的边不列，免得读的人要在负数里挑。 */
function clippedEdges(box: Bounds): string[] {
  const edges: [string, number][] = [
    ['左', -box.minX],
    ['上', -box.minY],
    ['右', box.maxX - VIEW_BOX],
    ['下', box.maxY - VIEW_BOX],
  ]
  return edges
    .filter(([, over]) => over > 0)
    .map(([edge, over]) => `${edge} ${over.toFixed(2)}`)
}

describe('图标几何', () => {
  it('每个图标连描边都落在 24×24 视框内', () => {
    const clipped = Object.entries(ICONS)
      .map(([name, paths]) => ({ name, edges: clippedEdges(inkBounds(paths)) }))
      .filter(({ edges }) => edges.length > 0)
      .map(({ name, edges }) => `${name} 被裁掉：${edges.join('、')}`)
    expect(clipped).toEqual([])
  })

  it('量法自检：折线的极值就是它字面的坐标外扩半个线宽', () => {
    expect(inkBounds(['m6 9 6 6 6-6'])).toEqual({
      minX: 5,
      minY: 8,
      maxX: 19,
      maxY: 16,
    })
  })

  it('量法自检：圆弧鼓出的部分算得进去，不是只看两端', () => {
    // 圆心 (12,12) 半径 6 的整圆，端点全在 y=12——只看端点会漏掉上下各 6
    const box = inkBounds(['M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0'])
    expect(box.minY).toBeCloseTo(5, 2)
    expect(box.maxY).toBeCloseTo(19, 2)
  })
})
