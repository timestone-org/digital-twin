/**
 * @fileoverview 锁住闭合取值域本身的形状：每个白名单不许有重名档、派生出来的几组
 * （缺省状态 / 连线走线 / 端口出线方向）必须真的由基础几档拼出来，
 * 内置图标那两份名单必须互为子集。
 * ⚠ 白名单里多一档或少一档都不报错——归一化只会把落不进白名单的取值悄悄换成缺省。
 */
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_ANCHORS,
  TWIN_2D_ANIM_KINDS,
  TWIN_2D_CONDITION_KINDS,
  TWIN_2D_DEFAULT_STATUSES,
  TWIN_2D_EDGE_ROUTES,
  TWIN_2D_EXPR_KINDS,
  TWIN_2D_FILL_KINDS,
  TWIN_2D_FIXED_COLOR_SPRITES,
  TWIN_2D_MARK_KINDS,
  TWIN_2D_PLACEMENT_KINDS,
  TWIN_2D_PORT_SIDES,
  TWIN_2D_PRIM_KINDS,
  TWIN_2D_ROUTE_KINDS,
  TWIN_2D_SHAPE_KINDS,
  TWIN_2D_SIDES,
  TWIN_2D_SIDE_PRIORITY,
  TWIN_2D_SPRITE_GRADIENT_IDS,
  TWIN_2D_SPRITE_IDS,
  TWIN_2D_STATUSES,
  TWIN_2D_THRESHOLD_OPS,
  TWIN_2D_TRANSITION_PROPS,
} from '../src/kinds'

/** 每个取值域一条：名字 → 那一份白名单 */
const CLOSED_SETS: readonly (readonly [string, readonly string[]])[] = [
  ['图元', TWIN_2D_PRIM_KINDS],
  ['摆位', TWIN_2D_PLACEMENT_KINDS],
  ['锚点', TWIN_2D_ANCHORS],
  ['状态', TWIN_2D_STATUSES],
  ['缺省状态', TWIN_2D_DEFAULT_STATUSES],
  ['标注', TWIN_2D_MARK_KINDS],
  ['走线', TWIN_2D_ROUTE_KINDS],
  ['连线走线', TWIN_2D_EDGE_ROUTES],
  ['出线方向', TWIN_2D_PORT_SIDES],
  ['过渡属性', TWIN_2D_TRANSITION_PROPS],
  ['动画', TWIN_2D_ANIM_KINDS],
  ['填充', TWIN_2D_FILL_KINDS],
  ['几何', TWIN_2D_SHAPE_KINDS],
  ['条件', TWIN_2D_CONDITION_KINDS],
  ['算式算子', TWIN_2D_EXPR_KINDS],
  ['阈值算子', TWIN_2D_THRESHOLD_OPS],
  ['内置图标', TWIN_2D_SPRITE_IDS],
  ['多色图标', TWIN_2D_FIXED_COLOR_SPRITES],
  ['文档级渐变', TWIN_2D_SPRITE_GRADIENT_IDS],
]

describe('闭合取值域', () => {
  it('每一份白名单里都没有重名档', () => {
    for (const [name, values] of CLOSED_SETS) {
      expect([name, new Set(values).size]).toEqual([name, values.length])
    }
  })

  it('档数与设计文档逐条对得上', () => {
    expect(TWIN_2D_PRIM_KINDS).toEqual(['box', 'vec', 'ico', 'txt'])
    expect(TWIN_2D_PLACEMENT_KINDS).toHaveLength(5)
    expect(TWIN_2D_ANCHORS).toHaveLength(9)
    expect(TWIN_2D_MARK_KINDS).toEqual(['rect', 'line', 'text'])
    expect(TWIN_2D_TRANSITION_PROPS).toHaveLength(6)
    expect(TWIN_2D_ANIM_KINDS).toHaveLength(5)
    expect(TWIN_2D_EXPR_KINDS).toHaveLength(7)
    expect(TWIN_2D_CONDITION_KINDS).toHaveLength(6)
  })

  // ⚠ 阈值算子与 @dt/modules/shared/thresholds 的 THRESHOLD_OPS 是两份副本，
  //   漂移的表现是同一条 between 在阈值卡片上成立、在 2D 图上不成立
  it('阈值算子逐字是那八档', () => {
    expect(TWIN_2D_THRESHOLD_OPS).toEqual([
      'lt',
      'lte',
      'gt',
      'gte',
      'between',
      'outside',
      'eq',
      'neq',
    ])
  })
})

describe('派生出来的几组', () => {
  it('缺省状态 = 四档状态再加一个 hidden', () => {
    expect(TWIN_2D_DEFAULT_STATUSES).toEqual([...TWIN_2D_STATUSES, 'hidden'])
  })

  it('连线走线 = auto 加四档走线', () => {
    expect(TWIN_2D_EDGE_ROUTES).toEqual(['auto', ...TWIN_2D_ROUTE_KINDS])
  })

  // ⚠ 'auto' 必须在进正交路由之前解析掉：流进去会取到一个隐式的 undefined 分支，
  //   表现是这一条线从节点中心横穿出去、其余线全对
  it('端口出线方向 = 四档 Side 再加一个待解析的 auto', () => {
    expect(TWIN_2D_PORT_SIDES).toEqual([...TWIN_2D_SIDES, 'auto'])
    expect(TWIN_2D_SIDES).not.toContain('auto')
  })

  it('并列时的解析序就是 Side 的文档序', () => {
    expect(TWIN_2D_SIDE_PRIORITY).toEqual(['top', 'right', 'bottom', 'left'])
  })
})

describe('内置图标集', () => {
  it('11 枚 symbol id 逐个对得上 icons.svg', () => {
    expect(TWIN_2D_SPRITE_IDS).toEqual([
      'ico-src-waste-heat',
      'ico-src-steam',
      'ico-src-air-source',
      'ico-src-solar',
      'ico-vsl-tank',
      'ico-vsl-manifold',
      'ico-hx',
      'ico-term-shower',
      'ico-term-radiator',
      'ico-term-ac',
      'ico-tap',
    ])
  })

  // ⚠ 名单少一个 → 那枚多色图标的颜色控件可点、点了没反应；
  //   多一个 → 一枚本可染色的图标被白白禁掉。两头都零报错
  it('4 枚多色图标是 11 枚的子集，且正好是四枚能源源图标', () => {
    expect(TWIN_2D_FIXED_COLOR_SPRITES).toHaveLength(4)
    for (const id of TWIN_2D_FIXED_COLOR_SPRITES) {
      expect(TWIN_2D_SPRITE_IDS).toContain(id)
      expect(id.startsWith('ico-src-')).toBe(true)
    }
  })

  it('四个文档级渐变 id 与 symbol id 不重名', () => {
    for (const id of TWIN_2D_SPRITE_GRADIENT_IDS) {
      expect(TWIN_2D_SPRITE_IDS).not.toContain(id)
    }
  })
})
