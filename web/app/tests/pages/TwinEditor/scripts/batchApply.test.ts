/** @fileoverview 批量配置的两种落地：只在真有改动时写一帧，并如实报改了几处。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { createBinding } from '@/features/dashboard/editorDoc'
import {
  applyBatchBindings,
  applyBatchConfig,
} from '@/pages/TwinEditor/scripts/batchApply'
import { createTwinDoc } from '@/pages/TwinEditor/scripts/twinDoc'

const CONFIG = normalizeTwinConfig({
  parts: [
    { id: 'a', name: '泵' },
    { id: 'b', name: '阀' },
  ],
})

describe('批量写回配置', () => {
  it('数出真正变了的部件并写成一帧', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })
    const next = normalizeTwinConfig({
      parts: [
        { id: 'a', name: '泵' },
        { id: 'b', name: '新阀' },
      ],
    })

    expect(applyBatchConfig(doc, next)).toBe(1)
    expect(doc.config.value.parts[1]?.name).toBe('新阀')
    expect(doc.canUndo.value).toBe(true)
  })

  // ⚠ 没改动也写一帧的话，撤销栈里多出一条什么都不退的记录
  it('一个都没变就不写', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [] })

    expect(applyBatchConfig(doc, CONFIG)).toBe(0)
    expect(doc.canUndo.value).toBe(false)
  })
})

describe('批量替换绑定', () => {
  const binding = {
    ...createBinding('n', 'partValues[0].value'),
    sourceKind: 'opcua' as const,
    nodeKey: 's:old',
  }

  it('只数点位真正换了的那几条', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [binding] })

    expect(applyBatchBindings(doc, [{ ...binding, nodeKey: 's:new' }])).toBe(1)
    expect(doc.bindings.value[0]?.nodeKey).toBe('s:new')
  })

  it('一条都没换就不写', () => {
    const doc = createTwinDoc({ config: CONFIG, bindings: [binding] })

    expect(applyBatchBindings(doc, [binding])).toBe(0)
    expect(doc.canUndo.value).toBe(false)
  })
})
