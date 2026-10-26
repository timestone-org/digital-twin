/** @fileoverview 区块尺寸分配与本地份额存储的边界行为。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allocateSizes,
  initialShares,
  pairLimits,
  readShares,
  resizePair,
  writeShares,
} from '../../../src/components/DtResizableLayout/layoutSizes'

const panes = [
  { id: 'left', size: 1, minSize: 100 },
  { id: 'right', size: 3, minSize: 100 },
]
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('区块尺寸', () => {
  it('极大有限份额不会使尺寸溢出为非有限数', () => {
    expect(allocateSizes([1e308, 1e308], panes, 1000).sizes).toEqual([500, 500])
  })
  it('按份额分配并填满可用空间', () => {
    const allocated = allocateSizes([1, 3], panes, 800).sizes
    expect(allocated[0]).toBeCloseTo(200)
    expect(allocated[1]).toBeCloseTo(600)
  })
  it('给低于下限的区域保留下限，其余区域分享余量', () => {
    expect(allocateSizes([1, 100], panes, 800).sizes).toEqual([100, 700])
    expect(
      allocateSizes([1, 2, 100], [...panes, { id: 'third', minSize: 300 }], 700)
        .sizes,
    ).toEqual([100, 100, 500])
  })
  it('容器不足时同比缩小下限，不产生溢出', () => {
    expect(allocateSizes([1, 3], panes, 100)).toEqual({
      sizes: [50, 50],
      minimums: [50, 50],
    })
    expect(allocateSizes([1, 3], panes, -10).sizes).toEqual([0, 0])
  })
  it('缺省或非有限份额与最小尺寸回退安全值', () => {
    expect(
      initialShares([
        { id: 'one' },
        { id: 'two', size: Number.NaN },
        { id: 'three', size: -1 },
      ]),
    ).toEqual([1, 1, 1])
    expect(
      allocateSizes(
        [Number.NaN, -1],
        [{ id: 'one' }, { id: 'two', minSize: -5 }],
        500,
      ).sizes,
    ).toEqual([250, 250])
    expect(allocateSizes([], [], 500).sizes).toEqual([])
  })
  it('只调整相邻两个区域并夹紧到两侧下限', () => {
    expect(resizePair([200, 300, 400], [100, 150, 200], 0, 350)).toEqual([
      350, 150, 400,
    ])
    expect(resizePair([200, 300, 400], [100, 150, 200], 1, -100)).toEqual([
      200, 150, 550,
    ])
    expect(pairLimits([], [], 0)).toEqual({ min: 0, max: 0 })
  })
  it('份额数量少于区块数量时使用缺省权重', () => {
    expect(allocateSizes([], panes, 600).sizes).toEqual([300, 300])
  })
  it('无效分隔位置和非有限尺寸不改变原尺寸', () => {
    for (const [index, wanted] of [
      [-1, 20],
      [2, 20],
      [0, Number.NaN],
    ]) {
      expect(resizePair([100, 200], [50, 50], index ?? 0, wanted ?? 0)).toEqual(
        [100, 200],
      )
    }
  })
})

describe('尺寸份额存档', () => {
  it('依稳定区块 id 读写份额，布局重排不串尺寸', () => {
    writeShares(panes, [400, 600], 'layout')
    expect(readShares([...panes].reverse(), 'layout')).toEqual([600, 400])
  })
  it('未知或非法存档字段按各区域初始份额回退', () => {
    localStorage.setItem('layout', '{"left":0,"right":"bad","extra":5}')
    expect(readShares(panes, 'layout')).toEqual([1, 3])
    for (const raw of ['null', '[]', '5', '{']) {
      localStorage.setItem('layout', raw)
      expect(readShares(panes, 'layout')).toEqual([1, 3])
    }
  })
  it('未提供存储键不会读写存储', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem')
    const set = vi.spyOn(Storage.prototype, 'setItem')
    expect(readShares(panes, undefined)).toEqual([1, 3])
    writeShares(panes, [1, 3], undefined)
    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
  it('存储拒绝访问不影响尺寸调整', () => {
    const getItem = vi.fn(() => {
      throw new Error('blocked')
    })
    const setItem = vi.fn(() => {
      throw new Error('blocked')
    })
    vi.stubGlobal('localStorage', { getItem, setItem })
    expect(readShares(panes, 'layout')).toEqual([1, 3])
    expect(() => writeShares(panes, [1, 3], 'layout')).not.toThrow()
    expect(getItem).toHaveBeenCalledWith('layout')
    expect(setItem).toHaveBeenCalledOnce()
  })
  it('持久化时过滤不可用的份额', () => {
    writeShares(panes, [Number.NaN], 'layout')
    expect(readShares(panes, 'layout')).toEqual([1, 1])
  })
})
