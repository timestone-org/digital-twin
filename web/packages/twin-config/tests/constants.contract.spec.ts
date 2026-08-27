/**
 * @fileoverview 锁死绑定槽键在三处的一致：模块清单声明的槽、编辑器写库的 fieldKey、
 * 运行时缝合读的子槽。⚠ 这三处任意一处把名字写错，typecheck 与 lint 都放行，
 * 表现只是「这个槽永远取不到值」——只有这条契约测试拦得住。
 */
import type { BindingSpec } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ANCHOR_ROW_SLOTS,
  TWIN_ARROW_BINDING_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_FLOW_ROW_SLOTS,
  TWIN_PANEL_BINDING_KEY,
  TWIN_PART_BINDING_KEY,
  TWIN_PART_FIELD_BINDING_KEY,
  TWIN_VIEW_BINDINGS,
  anchorRowFieldKey,
  arrayRowFieldKey,
  arrowRowFieldKey,
  flowRowFieldKey,
  panelRowFieldKey,
  partRowFieldKey,
} from '../src/constants'
import { stitchAnchorValues } from '../src/twinMath'
import { normalizeTwinConfig } from '../src/normalize'

function specOf(key: string): BindingSpec {
  const found = TWIN_VIEW_BINDINGS.find((spec) => spec.key === key)
  if (found === undefined) throw new Error(`模块清单里没有绑定槽 ${key}`)
  return found
}

function rowOf(spec: BindingSpec): Record<string, unknown> {
  return Object.fromEntries(
    (spec.arrayFields ?? []).map((field) => [field.key, `填入:${field.key}`]),
  )
}

const CONFIG = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

describe('绑定槽清单', () => {
  it('清单里的槽与槽键常量逐一对上', () => {
    expect(TWIN_VIEW_BINDINGS.map((spec) => spec.key)).toEqual([
      TWIN_PART_BINDING_KEY,
      TWIN_ANCHOR_BINDING_KEY,
      TWIN_PANEL_BINDING_KEY,
      TWIN_ARROW_BINDING_KEY,
      TWIN_FLOW_BINDING_KEY,
      TWIN_PART_FIELD_BINDING_KEY,
    ])
  })

  it('三个槽都是数组槽', () => {
    expect(specOf(TWIN_PART_BINDING_KEY).isArray).toBe(true)
    expect(specOf(TWIN_ANCHOR_BINDING_KEY).isArray).toBe(true)
    expect(specOf(TWIN_PANEL_BINDING_KEY).isArray).toBe(true)
    expect(specOf(TWIN_ARROW_BINDING_KEY).isArray).toBe(true)
  })

  // ⚠ 只许登记渲染层真正消费的槽：没有图元就摆槽位，用户绑完点位看到的是
  //   「绑了没反应」。六个槽此刻各有一处在消费（详情字段在部件详情卡片上，
  //   部件读数在 `PartsLayer` 的状态染色上），
  //   加第七个必须与渲染层同轮落地
  it('清单里的每个槽都有渲染层在消费', () => {
    expect(TWIN_VIEW_BINDINGS).toHaveLength(6)
  })

  it('能量流那一行有强度与激活两个子槽', () => {
    expect(
      (specOf(TWIN_FLOW_BINDING_KEY).arrayFields ?? []).map(
        (field) => field.key,
      ),
    ).toEqual([...TWIN_FLOW_ROW_SLOTS])
  })

  it('清单声明的行内子槽与子槽常量逐一对上', () => {
    expect(
      (specOf(TWIN_ANCHOR_BINDING_KEY).arrayFields ?? []).map(
        (field) => field.key,
      ),
    ).toEqual([...TWIN_ANCHOR_ROW_SLOTS])
  })
})

describe('数组行 fieldKey', () => {
  it('形状是 槽键[下标].子槽', () => {
    expect(arrayRowFieldKey('rows', 0, 'value')).toBe('rows[0].value')
  })

  it('四类的构造函数走同一套形状', () => {
    expect(partRowFieldKey(4)).toBe('partValues[4].value')
    expect(anchorRowFieldKey(3)).toBe('anchorValues[3].value')
    expect(panelRowFieldKey(1)).toBe('panelValues[1].value')
    expect(arrowRowFieldKey(2)).toBe('arrowValues[2].value')
    expect(flowRowFieldKey(0, 'intensity')).toBe('flowValues[0].intensity')
  })

  it('构造出的槽键前缀就是清单里的槽', () => {
    expect(anchorRowFieldKey(0).startsWith(TWIN_ANCHOR_BINDING_KEY)).toBe(true)
  })
})

describe('缝合读的子槽就是清单声明的子槽', () => {
  it('锚点行里每个声明过的子槽都被读到', () => {
    expect(
      stitchAnchorValues(CONFIG.anchors, [
        rowOf(specOf(TWIN_ANCHOR_BINDING_KEY)),
      ]),
    ).toEqual({ a1: { value: '填入:value' } })
  })
})
