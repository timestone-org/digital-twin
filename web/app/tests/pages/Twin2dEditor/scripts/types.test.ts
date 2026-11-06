/** @fileoverview 契约：五类实体的显示名与 `Twin2dConfig` 上的数组字段名一一对应。 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_ENTITY_LABELS } from '@/pages/Twin2dEditor/scripts/types'

describe('实体显示名', () => {
  it('五类实体各有一个名字', () => {
    expect(Object.keys(TWIN_2D_ENTITY_LABELS)).toEqual([
      'nodes',
      'edges',
      'marks',
      'styles',
      'edgeStyles',
    ])
  })

  it('名字都不为空，否则大纲上会出现一段没有标题的分组', () => {
    for (const label of Object.values(TWIN_2D_ENTITY_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })
})
