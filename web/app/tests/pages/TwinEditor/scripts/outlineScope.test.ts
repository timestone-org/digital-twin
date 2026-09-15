/** @fileoverview 分类与未绑定筛选不改变文档序号。 */
import { createBinding } from '@/features/dashboard/editorDoc'
import { normalizeTwinConfig } from '@dt/twin-config'
import { expect, it } from 'vitest'
import {
  buildTwinOutline,
  TWIN_SCENE_ENTRIES,
} from '@/pages/TwinEditor/scripts/outlineNodes'
import { filterTwinOutline } from '@/pages/TwinEditor/scripts/outlineFilter'
import { scopeOutline } from '@/pages/TwinEditor/scripts/outlineScope'
it('只显示缺少绑定的信息牌，仍保留原始行号', () => {
  const config = normalizeTwinConfig({
    panels: [
      { id: 'a', fields: [{ key: 't' }] },
      { id: 'b', fields: [{ key: 't' }] },
    ],
  })
  const view = filterTwinOutline(
    buildTwinOutline(config, new Set()),
    TWIN_SCENE_ENTRIES,
    '',
  )
  const result = scopeOutline(
    view,
    config,
    [
      {
        ...createBinding('n', 'panelValues[0].value'),
        sourceKind: 'opcua',
        nodeKey: 'source:A',
      },
    ],
    'panels',
    'unbound',
  )
  expect(
    result.sections.flatMap((section) =>
      section.rows.map((row) => [row.row.id, row.row.index]),
    ),
  ).toEqual([['b', 2]])
  expect(result.scene).toEqual([])
})
