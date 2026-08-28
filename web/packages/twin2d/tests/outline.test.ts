/**
 * @fileoverview 契约：外接矩形上的一点投到样式声明的外缘上——四档各自的解，四条边的
 * 中点一律原地不动，投影只往里收不往外推，法线一个字都不动。
 *
 * ⚠ 这几条错了都不报错：符号画得对、线也画得对，只是线头停在一个符号上没有的地方，
 * 或者反过来扎进符号里。
 * ⚠ 法线跟着投成径向的话，贴着圆角出来的线会斜着扎出去——正交路由的前提是四正方向，
 * 而那一步在图上表现为「有几条线拐弯拐得很怪」。
 */
import { describe, expect, it } from 'vitest'

import { perimeterPoint } from '../src/geometry'
import { twin2dOutlinePoint } from '../src/outline'
import type { Box } from '../src/geometry'
import type { Twin2dOutline } from '../src/types'

/** 一只 200×100 的盒，中心在原点：半宽 100、半高 50，两轴不同才看得出写反。 */
const BOX: Box = { x: 0, y: 0, w: 200, h: 100 }

/** 四条边的中点对应的周长参数：上 .125 / 右 .375 / 下 .625 / 左 .875。 */
const MID_T = [0.125, 0.375, 0.625, 0.875]

const RECT: Twin2dOutline = { kind: 'rect', r: 0 }
const ROUND: Twin2dOutline = { kind: 'round', r: 20 }
const ELLIPSE: Twin2dOutline = { kind: 'ellipse', r: 0 }
const CAPSULE: Twin2dOutline = { kind: 'capsule', r: 0 }

/**
 * 投一次，只取落点。
 * @param outline 外缘
 * @param t 周长参数
 */
function at(outline: Twin2dOutline, t: number): { x: number; y: number } {
  return twin2dOutlinePoint(BOX, outline, perimeterPoint(BOX, t)).point
}

describe('矩形那一档', () => {
  it('原样返回，一个数都不动', () => {
    for (const t of [0, 0.1, 0.25, 0.4, 0.9]) {
      expect(at(RECT, t)).toEqual(perimeterPoint(BOX, t).point)
    }
  })
})

describe('四条边的中点', () => {
  // ⚠ 四档外缘都与外接矩形在这四处相切：动了的话，预置库那四个中点端口会整体偏出去
  it.each([
    ['round', ROUND],
    ['ellipse', ELLIPSE],
    ['capsule', CAPSULE],
  ] as const)('%s 档下一律原地不动', (_name, outline) => {
    for (const t of MID_T) {
      const before = perimeterPoint(BOX, t).point
      expect(at(outline, t).x).toBeCloseTo(before.x, 9)
      expect(at(outline, t).y).toBeCloseTo(before.y, 9)
    }
  })
})

describe('往里收', () => {
  it('圆角档把四角上的点拉到那枚角圆上', () => {
    // ⚠ 射线是「盒心 → 原落点」，200×100 的盒上它的斜率是 0.5 而**不是** 45°：
    // 断言只能是「落在那枚角圆上」，写死一个手算的坐标就把一个错的方向锁死了
    const point = at(ROUND, 0)

    expect(Math.hypot(point.x + 80, point.y + 30)).toBeCloseTo(20, 9)
    expect(point.x).toBeGreaterThan(-100)
    expect(point.y).toBeGreaterThan(-50)
  })

  it('椭圆档把角上的点拉到椭圆上', () => {
    const point = at(ELLIPSE, 0)

    // 落在椭圆上：(x/100)² + (y/50)² = 1
    expect((point.x / 100) ** 2 + (point.y / 50) ** 2).toBeCloseTo(1, 9)
    expect(Math.abs(point.x)).toBeLessThan(100)
  })

  it('胶囊档的圆角半径就是短边之半，比圆角档收得更狠', () => {
    expect(Math.abs(at(CAPSULE, 0).x)).toBeLessThan(Math.abs(at(ROUND, 0).x))
  })

  it('每一档都只往里收，一处都不许推到外接矩形之外', () => {
    for (const outline of [ROUND, ELLIPSE, CAPSULE]) {
      for (let t = 0; t < 1; t += 0.01) {
        const point = at(outline, t)
        expect(Math.abs(point.x)).toBeLessThanOrEqual(100 + 1e-9)
        expect(Math.abs(point.y)).toBeLessThanOrEqual(50 + 1e-9)
      }
    }
  })
})

describe('盒内部的点', () => {
  // ⚠ `xy` 端口可以被有意摆在符号内部；往外推会把它们一律弹到外缘上，而配置里那个
  // 坐标看着还是对的
  it('原地不动，不会被推到外缘上', () => {
    const inside = { point: { x: 10, y: 5 }, normal: { x: 0, y: -1 } }

    expect(twin2dOutlinePoint(BOX, ELLIPSE, inside).point).toEqual({
      x: 10,
      y: 5,
    })
  })

  it('正中那一点原样返回，不产 NaN', () => {
    const center = { point: { x: 0, y: 0 }, normal: { x: 0, y: -1 } }

    expect(twin2dOutlinePoint(BOX, CAPSULE, center).point).toEqual({
      x: 0,
      y: 0,
    })
  })
})

describe('法线', () => {
  // ⚠ 投成径向的话，贴着圆角出来的线会斜着扎出去，而正交路由只吃四正方向
  it('一个字都不动，原样带出去', () => {
    const raw = perimeterPoint(BOX, 0.3)

    expect(twin2dOutlinePoint(BOX, ELLIPSE, raw).normal).toEqual(raw.normal)
  })
})

describe('退化的盒', () => {
  it('宽高非正时原样返回，不产 NaN', () => {
    const flat: Box = { x: 0, y: 0, w: 0, h: 0 }
    const raw = { point: { x: 3, y: 4 }, normal: { x: 1, y: 0 } }

    expect(twin2dOutlinePoint(flat, ELLIPSE, raw).point).toEqual({ x: 3, y: 4 })
  })
})
