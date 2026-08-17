/**
 * @fileoverview 契约：一袋模块 values 缝成场景五路实时值。
 * ⚠ 运行态渲染器与编辑视口共用这一支，所以这里钉死的对齐顺序就是两边看到的
 * 同一个结果——信息牌与钻取节点都按**扁平化后的字段序**对齐，按「第 i 张牌」
 * 对齐会让多字段的牌之后整条错位，而两边都不报错。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_HIER_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
} from '../src/constants'
import { normalizeTwinConfig } from '../src/normalize'
import { twinSceneValues } from '../src/sceneValues'

/** 两张牌：第一张两个字段，第二张一个——足以暴露「按牌对齐」的错法。 */
const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1' }, { id: 'a2' }],
  panels: [
    {
      id: 'p1',
      fields: [
        { key: 'temp', label: '温度' },
        { key: 'flow', label: '流量' },
      ],
    },
    { id: 'p2', fields: [{ key: 'load', label: '负荷' }] },
  ],
  arrows: [{ id: 'ar1' }],
  flows: [{ id: 'f1' }],
  hierNodes: [
    {
      id: 'h1',
      fields: [
        { key: 'x', label: 'X' },
        { key: 'y', label: 'Y' },
      ],
    },
    { id: 'h2', fields: [{ key: 'z', label: 'Z' }] },
  ],
})

function rowsOf(values: readonly number[]): { value: number }[] {
  return values.map((value) => ({ value }))
}

describe('缝合五路', () => {
  it('锚点、箭头按文档序对齐到实体 id', () => {
    const live = twinSceneValues(CONFIG, {
      [TWIN_ANCHOR_BINDING_KEY]: rowsOf([1, 2]),
      [TWIN_ARROW_BINDING_KEY]: rowsOf([7]),
    })

    expect(live.anchors).toEqual({ a1: { value: 1 }, a2: { value: 2 } })
    expect(live.arrows).toEqual({ ar1: { value: 7 } })
  })

  it('信息牌按扁平化后的字段序对齐，第三行落在第二张牌上', () => {
    const live = twinSceneValues(CONFIG, {
      [TWIN_PANEL_BINDING_KEY]: rowsOf([10, 20, 30]),
    })

    expect(live.panels).toEqual({
      'p1::temp': { value: 10 },
      'p1::flow': { value: 20 },
      'p2::load': { value: 30 },
    })
  })

  it('钻取节点同理，也按扁平化后的字段序对齐', () => {
    const live = twinSceneValues(CONFIG, {
      [TWIN_HIER_BINDING_KEY]: rowsOf([1, 2, 3]),
    })

    expect(live.hier).toEqual({
      'h1::x': { value: 1 },
      'h1::y': { value: 2 },
      'h2::z': { value: 3 },
    })
  })

  it('能量流的两个子槽只要有一个有值就产出条目', () => {
    const live = twinSceneValues(CONFIG, {
      [TWIN_FLOW_BINDING_KEY]: [{ intensity: 0.5 }],
    })

    expect(live.flows.f1?.intensity).toBe(0.5)
  })

  it('一个槽都没喂时五路都是空表，不是一堆 undefined 条目', () => {
    const live = twinSceneValues(CONFIG, {})

    expect(live).toEqual({
      anchors: {},
      arrows: {},
      panels: {},
      flows: {},
      hier: {},
    })
  })

  it('喂多出来的行不会凭空造出实体', () => {
    const live = twinSceneValues(CONFIG, {
      [TWIN_ANCHOR_BINDING_KEY]: rowsOf([1, 2, 3, 4]),
    })

    expect(Object.keys(live.anchors)).toEqual(['a1', 'a2'])
  })
})
