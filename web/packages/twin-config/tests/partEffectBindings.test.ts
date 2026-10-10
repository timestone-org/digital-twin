/** @fileoverview 状态效果单独取数，配置关闭、实体重排不串用染色或详情点位。 */
import { describe, expect, it } from 'vitest'

import {
  remapTwinBindings,
  twinBindingRows,
  twinRowsOfEntity,
} from '../src/bindingRows'
import { normalizeTwinConfig } from '../src/normalize'
import { twinSceneValues } from '../src/sceneValues'

const RAW = {
  parts: [
    { id: 'plain' },
    {
      id: 'pump',
      name: '水泵',
      tint: { stops: [] },
      effect: { enabled: true, mode: 'point', pattern: 'blink' },
      detail: { fields: [{ key: 'temp' }] },
    },
    { id: 'fan', effect: { enabled: false, mode: 'always' } },
    { id: 'valve', tint: { stops: [] } },
  ],
}

describe('部件效果绑定独立于染色和详情', () => {
  it('按配置效果的部件过滤，关闭和常开模式保留可绑的行', () => {
    const config = normalizeTwinConfig(RAW)
    expect(
      twinBindingRows(config)
        .filter((row) => row.slotKey === 'partEffectValues')
        .map((row) => [row.fieldKey, row.entityId]),
    ).toEqual([
      ['partEffectValues[0].value', 'pump'],
      ['partEffectValues[1].value', 'fan'],
    ])
    expect(twinRowsOfEntity(config, 'parts', 'pump')).toEqual({
      partValues: [0],
      partEffectValues: [0],
      partFieldValues: [0],
    })
  })

  it('同一部件的效果、染色和详情值分别缝合', () => {
    const values = twinSceneValues(normalizeTwinConfig(RAW), {
      partValues: [{ value: 80 }, { value: 10 }],
      partEffectValues: [{ value: true }, { value: 0 }],
      partFieldValues: [{ value: 30 }],
    })
    expect(values.parts).toEqual({ pump: { value: 80 }, valve: { value: 10 } })
    expect(values.effectParts).toEqual({
      pump: { value: true },
      fan: { value: 0 },
    })
    expect(values.partFields).toEqual({ 'pump::temp': { value: 30 } })
  })

  it('关闭和重排效果只按各自槽的实体身份搬点位', () => {
    const before = normalizeTwinConfig(RAW)
    const after = normalizeTwinConfig({ parts: [...RAW.parts].reverse() })
    const bindings = [
      { fieldKey: 'partValues[0].value', point: 'temperature' },
      { fieldKey: 'partEffectValues[0].value', point: 'pump-switch' },
      { fieldKey: 'partEffectValues[1].value', point: 'fan-switch' },
      { fieldKey: 'partFieldValues[0].value', point: 'detail-temperature' },
    ]
    expect(remapTwinBindings(before, after, bindings)).toEqual([
      { fieldKey: 'partValues[1].value', point: 'temperature' },
      { fieldKey: 'partEffectValues[1].value', point: 'pump-switch' },
      { fieldKey: 'partEffectValues[0].value', point: 'fan-switch' },
      { fieldKey: 'partFieldValues[0].value', point: 'detail-temperature' },
    ])
    const disabled = normalizeTwinConfig({
      ...RAW,
      parts: RAW.parts.map((part) =>
        part.id === 'pump'
          ? { ...part, effect: { ...part.effect, enabled: false } }
          : part,
      ),
    })
    expect(remapTwinBindings(before, disabled, bindings)).toEqual(bindings)
  })

  it('新增和删除效果部件只搬自身槽，染色和详情绑定不变', () => {
    const before = normalizeTwinConfig(RAW)
    const added = normalizeTwinConfig({
      parts: [{ id: 'new', effect: {} }, ...RAW.parts],
    })
    const bindings = [
      { fieldKey: 'partValues[0].value', point: 'temperature' },
      { fieldKey: 'partEffectValues[0].value', point: 'pump-switch' },
      { fieldKey: 'partEffectValues[1].value', point: 'fan-switch' },
      { fieldKey: 'partFieldValues[0].value', point: 'detail-temperature' },
    ]
    expect(remapTwinBindings(before, added, bindings)).toEqual([
      { fieldKey: 'partValues[0].value', point: 'temperature' },
      { fieldKey: 'partEffectValues[1].value', point: 'pump-switch' },
      { fieldKey: 'partEffectValues[2].value', point: 'fan-switch' },
      { fieldKey: 'partFieldValues[0].value', point: 'detail-temperature' },
    ])
    const removed = normalizeTwinConfig({
      parts: RAW.parts.map((part) =>
        part.id === 'pump' ? { ...part, effect: null } : part,
      ),
    })
    expect(remapTwinBindings(before, removed, bindings)).toEqual([
      { fieldKey: 'partValues[0].value', point: 'temperature' },
      { fieldKey: 'partEffectValues[0].value', point: 'fan-switch' },
      { fieldKey: 'partFieldValues[0].value', point: 'detail-temperature' },
    ])
  })

  it('缺失或非有限的读数不编造效果触发值', () => {
    const values = twinSceneValues(normalizeTwinConfig(RAW), {
      partEffectValues: [{ value: Number.NaN }, undefined, { value: 1 }],
    })
    expect(values.effectParts).toEqual({})
  })
})
