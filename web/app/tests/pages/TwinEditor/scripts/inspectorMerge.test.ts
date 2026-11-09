/** @fileoverview 检查器写入的合并键：同实体同字段才合并，结构性改动一律不合并。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { inspectorMergeKey } from '@/pages/TwinEditor/scripts/inspectorMerge'

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1' }, { id: 'a2' }],
  panels: [{ id: 'p1', fields: [{ key: 'temp', label: '温度' }] }],
})

describe('inspectorMergeKey', () => {
  it('同一个实体的同一个字段给同一个键', () => {
    const first = inspectorMergeKey(CONFIG, {
      anchors: CONFIG.anchors.map((item, index) =>
        index === 0 ? { ...item, name: '甲' } : item,
      ),
    })
    const second = inspectorMergeKey(CONFIG, {
      anchors: CONFIG.anchors.map((item, index) =>
        index === 0 ? { ...item, name: '甲乙' } : item,
      ),
    })

    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })

  it('单例段按改到的字段出键', () => {
    const scale = inspectorMergeKey(CONFIG, {
      model: { ...CONFIG.model, scale: 2 },
    })
    const position = inspectorMergeKey(CONFIG, {
      model: { ...CONFIG.model, position: [1, 0, 0] },
    })

    expect(scale).toContain('model:scale')
    expect(position).not.toBe(scale)
  })

  // ⚠ 增删、重排并进上一帧的话，撤销一次会连同前面的输入一起退掉
  it('增删与重排不合并', () => {
    expect(
      inspectorMergeKey(CONFIG, { anchors: CONFIG.anchors.slice(1) }),
    ).toBeNull()
    expect(
      inspectorMergeKey(CONFIG, { anchors: [...CONFIG.anchors].reverse() }),
    ).toBeNull()
  })

  // ⚠ 牌里的字段、漫游的站点这类子列表同理：加一个字段并进前面的改名，撤一次两样都没了
  it('实体里的子列表增删不合并，同一子列表里改字段照样合并', () => {
    const panel = CONFIG.panels[0]
    if (panel === undefined) throw new Error('fixture')
    const field = panel.fields[0]
    if (field === undefined) throw new Error('fixture')
    const withFields = (fields: typeof panel.fields) => ({
      panels: [{ ...panel, fields }],
    })

    expect(
      inspectorMergeKey(
        CONFIG,
        withFields([...panel.fields, { ...field, key: 'flow' }]),
      ),
    ).toBeNull()
    expect(inspectorMergeKey(CONFIG, withFields([]))).toBeNull()
    expect(
      inspectorMergeKey(CONFIG, {
        roamTour: { ...CONFIG.roamTour, items: ['c1'] },
      }),
    ).toBeNull()
    expect(
      inspectorMergeKey(CONFIG, withFields([{ ...field, label: '罐温' }])),
    ).toBe('inspect|panels:p1:fields')
  })

  it('什么都没变时给 null', () => {
    expect(inspectorMergeKey(CONFIG, { anchors: CONFIG.anchors })).toBeNull()
    expect(inspectorMergeKey(CONFIG, {})).toBeNull()
  })
})
