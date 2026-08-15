/**
 * @fileoverview 距离规则、可见性与点击门禁的口径。
 *
 * ⚠ 这里守的第一条是「没配」与「配了个零」分得开：把没配归一成 0 之后，
 * `hideBelow` 就从「不做近距隐藏」变成「距离小于 0 时隐藏」——后者永不成立，
 * 于是两种配置看起来行为一样，而错的那一半永远不会被察觉。
 * ⚠ 第二条是参考系恒成对：同一个「20」在三种参考系下是三个位置。
 */
import { describe, expect, it } from 'vitest'

import {
  ALWAYS_VISIBLE,
  NO_CLICK_LIMIT,
  normalizeClickDistance,
  normalizeDistance,
  normalizeVisibility,
} from '../src/normalizeRules'

describe('距离规则', () => {
  it('阈值取不到就是没配，不回落成 0', () => {
    expect(normalizeDistance({}, 'orbit')).toBeNull()
    expect(normalizeDistance({ value: 'far' }, 'orbit')).toBeNull()
    expect(normalizeDistance(null, 'orbit')).toBeNull()
  })

  it('零是一个合法阈值，与没配不是一回事', () => {
    expect(normalizeDistance({ value: 0 }, 'orbit')).toEqual({
      ref: 'orbit',
      value: 0,
    })
  })

  it('负阈值照收：语义由消费方定，归一化不替它判断', () => {
    expect(normalizeDistance({ value: -3 }, 'self')?.value).toBe(-3)
  })

  it('参考系缺省按这一处给的来，不认识的取值也回落到它', () => {
    expect(normalizeDistance({ value: 1 }, 'part-center')?.ref).toBe(
      'part-center',
    )
    expect(normalizeDistance({ value: 1, ref: 'camera' }, 'self')?.ref).toBe(
      'self',
    )
  })

  it('显式给的参考系压过缺省', () => {
    expect(normalizeDistance({ value: 1, ref: 'orbit' }, 'self')?.ref).toBe(
      'orbit',
    )
  })
})

describe('可见性规则', () => {
  it('什么都没配时看得见，且不随距离变', () => {
    expect(normalizeVisibility(undefined)).toEqual(ALWAYS_VISIBLE)
  })

  // ⚠ 缺省不可见会让一份没配过的场景整个空掉，而用户看到的是
  //   「模型加载了但什么都没有」
  it('缺省是看得见', () => {
    expect(normalizeVisibility({}).visible).toBe(true)
  })

  it('老写法 visible 仍然读得进来', () => {
    expect(normalizeVisibility(undefined, false).visible).toBe(false)
    expect(normalizeVisibility(undefined, true).visible).toBe(true)
  })

  it('规则里的 visible 压过老写法', () => {
    expect(normalizeVisibility({ visible: true }, false).visible).toBe(true)
  })

  it('两条距离隐藏各自独立，没配的那条留 null', () => {
    const rule = normalizeVisibility({ hideAbove: { value: 50 } })
    expect(rule.hideBelow).toBeNull()
    expect(rule.hideAbove).toEqual({ ref: 'orbit', value: 50 })
  })

  it('淡出缺了阈值整条作废——半条规则插不出透明度', () => {
    expect(
      normalizeVisibility({ fade: { direction: 'below' } }).fade,
    ).toBeNull()
  })

  it('淡出的透明度夹在 [0,1]，方向缺省是远处淡', () => {
    const fade = normalizeVisibility({
      fade: { at: { value: 10 }, opacity: 9 },
    }).fade
    expect(fade).toEqual({
      at: { ref: 'orbit', value: 10 },
      direction: 'above',
      opacity: 1,
    })
  })

  it('淡出的透明度缺省是全透明：配了淡出却不给值时该淡掉', () => {
    expect(
      normalizeVisibility({ fade: { at: { value: 10 } } }).fade?.opacity,
    ).toBe(0)
  })
})

describe('点击门禁', () => {
  it('什么都没配时任何距离都能点', () => {
    expect(normalizeClickDistance(undefined)).toEqual(NO_CLICK_LIMIT)
  })

  // 「离这个部件多远」才是点它时人脑子里想的那个距离
  it('三个阈值的缺省参考系都是部件包围盒中心', () => {
    const rule = normalizeClickDistance({
      min: { value: 1 },
      max: { value: 2 },
      farThreshold: { value: 3 },
    })
    expect([rule.min?.ref, rule.max?.ref, rule.farThreshold?.ref]).toEqual([
      'part-center',
      'part-center',
      'part-center',
    ])
  })

  it('只配一条时另外两条留 null，不凭空补一个上限', () => {
    const rule = normalizeClickDistance({ max: { value: 30 } })
    expect(rule.min).toBeNull()
    expect(rule.farThreshold).toBeNull()
    expect(rule.max?.value).toBe(30)
  })
})
