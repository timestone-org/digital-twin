/**
 * @fileoverview 守两套坐标基准的口径：`center` 只挪前后左右、高度轴仍跟模型原点，
 * 换算来回一趟不掉精度，以及「没有模型就没有中心」这一支不许编一个数出来。
 */
import { describe, expect, it } from 'vitest'

import {
  sameVec3,
  toFrameCoords,
  toWorldCoords,
  twinFrameOrigin,
  type TwinHorizontalSpan,
} from '../src/coordFrame'
import type { Vec3 } from '../src/types'

/** 一块 20×20、中心落在 (10, -30) 的占地。 */
const SPAN: TwinHorizontalSpan = { minX: 0, maxX: 20, minZ: -40, maxZ: -20 }

describe('基准原点', () => {
  it('模型原点那一档就是模型自己的位置，包围盒一眼都不看', () => {
    expect(twinFrameOrigin('model', [3, 5, 7], SPAN)).toEqual([3, 5, 7])
  })

  // 用户要的正是这条：前后左右居中，但高度轴与模型坐标系一致
  it('模型中心那一档只挪前后左右，高度轴仍落在模型原点上', () => {
    expect(twinFrameOrigin('center', [3, 5, 7], SPAN)).toEqual([10, 5, -30])
  })

  it('缺省摆放 + 模型原点 = 世界原点（存量配置的读数一个字都不变）', () => {
    expect(twinFrameOrigin('model', [0, 0, 0], SPAN)).toEqual([0, 0, 0])
  })

  // ⚠ 编一个中心出来的话，全部读数会在模型装载的那一刻整片跳一次
  it('模型还没装载时退回模型原点，不编一个中心', () => {
    expect(twinFrameOrigin('center', [3, 5, 7], null)).toEqual([3, 5, 7])
  })

  it('包围盒里有非有限值时同样退回模型原点', () => {
    const broken: TwinHorizontalSpan = {
      minX: Number.NaN,
      maxX: 20,
      minZ: -40,
      maxZ: -20,
    }
    expect(twinFrameOrigin('center', [3, 5, 7], broken)).toEqual([3, 5, 7])
  })

  it('返回的是新数组，不把调用方的摆放数组交出去', () => {
    const position: Vec3 = [1, 2, 3]
    const origin = twinFrameOrigin('model', position, null)
    expect(origin).not.toBe(position)
  })
})

describe('读数换算', () => {
  it('世界坐标减原点得读数，加回去还是原来那个点', () => {
    const world: Vec3 = [12, 4, -25]
    const origin: Vec3 = [10, 0, -30]

    const shown = toFrameCoords(world, origin)

    expect(shown).toEqual([2, 4, 5])
    expect(toWorldCoords(shown, origin)).toEqual(world)
  })

  it('原点在世界原点上时读数就是世界坐标', () => {
    expect(toFrameCoords([7, 8, 9], [0, 0, 0])).toEqual([7, 8, 9])
  })
})

describe('三元组比较', () => {
  it('逐位相等才算没变；只差一位也算变了', () => {
    expect(sameVec3([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sameVec3([1, 2, 3], [1, 2, 3.0001])).toBe(false)
  })
})
