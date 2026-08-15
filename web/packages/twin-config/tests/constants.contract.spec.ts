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
  TWIN_VIEW_BINDINGS,
  anchorRowFieldKey,
  arrayRowFieldKey,
} from '../src/constants'
import { stitchAnchorValues } from '../src/twinMath'
import { normalizeTwinConfig } from '../src/types'

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
      TWIN_ANCHOR_BINDING_KEY,
    ])
  })

  it('锚点槽是数组槽', () => {
    expect(specOf(TWIN_ANCHOR_BINDING_KEY).isArray).toBe(true)
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

  it('锚点的构造函数走同一套形状', () => {
    expect(anchorRowFieldKey(3)).toBe('anchorValues[3].value')
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
