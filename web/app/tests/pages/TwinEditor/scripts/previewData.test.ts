/** @fileoverview 模拟数据按稳定字段身份覆盖，原始实时值不变。 */
import { normalizeTwinConfig, twinSceneValues } from '@dt/twin-config'
import { expect, it } from 'vitest'
import {
  previewDataRows,
  previewSample,
  sampleText,
  rowSample,
  applyPreviewData,
} from '@/pages/TwinEditor/scripts/previewData'
it('只覆盖当前信息牌字段，不改变其他对象或实时值', () => {
  const config = normalizeTwinConfig({
    panels: [
      { id: 'a', fields: [{ key: 'temp', label: '温度' }] },
      { id: 'b', fields: [{ key: 'temp' }] },
    ],
  })
  const values = twinSceneValues(config, {
    panelValues: [{ value: 10 }, { value: 20 }],
  })
  const rows = previewDataRows(config, { kind: 'panels', id: 'a' }, null)
  expect(rows.map((row) => row.key)).toEqual(['panels:a::temp'])
  const output = applyPreviewData(values, rows, { 'panels:a::temp': 0 })
  expect(output.panels).toEqual({
    'a::temp': { value: 0 },
    'b::temp': { value: 20 },
  })
  expect(values.panels['a::temp']?.value).toBe(10)
})
it('无数据模拟保留null，部件详情与染色分开', () => {
  const config = normalizeTwinConfig({
    parts: [{ id: 'p', detail: { fields: [{ key: 't' }] } }],
  })
  const rows = previewDataRows(config, { kind: 'parts', id: 'p' }, null)
  const output = applyPreviewData(twinSceneValues(config, {}), rows, {
    'partFields:p::t': null,
  })
  expect(output.partFields['p::t']).toEqual({ value: null })
})
it('模拟动画与能量流不会覆盖其他路数据', () => {
  const config = normalizeTwinConfig({
    model: { animations: { controls: [{ clip: 'spin', mode: 'point' }] } },
    anchors: [{ id: 'a' }, { id: 'b' }],
    flows: [{ id: 'f', pathAnchors: ['a', 'b'] }],
  })
  const values = twinSceneValues(config, {})
  const animation = previewDataRows(config, { kind: 'model' }, 'spin')
  expect(
    applyPreviewData(values, animation, { 'animations:spin': false })
      .animations,
  ).toEqual({ spin: false })
  const flows = previewDataRows(config, { kind: 'flows', id: 'f' }, null)
  expect(applyPreviewData(values, flows, { 'flows:f': 0 }).flows).toEqual({
    f: { intensity: 0, active: true },
  })
})
it('输入值保留布尔、文本与无数据语义', () => {
  expect(previewSample('0')).toBe(0)
  expect(previewSample('true')).toBe(true)
  expect(previewSample('false')).toBe(false)
  expect(previewSample('正常')).toBe('正常')
  expect(previewSample('  ')).toBeNull()
  expect(sampleText({})).toBe('')
  expect(sampleText(false)).toBe('false')
  const values = twinSceneValues(normalizeTwinConfig({}), {})
  expect(
    rowSample(values, {
      slot: 'animations',
      key: 'a',
      entityId: 'a',
      label: 'a',
    }),
  ).toBeUndefined()
  expect(
    rowSample(values, { slot: 'flows', key: 'f', entityId: 'f', label: 'f' }),
  ).toBeUndefined()
})
