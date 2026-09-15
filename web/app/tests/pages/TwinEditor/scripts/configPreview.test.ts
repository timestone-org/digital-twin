/** @fileoverview 配置预览跟随部件和视点，临时状态不污染草稿。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { expect, it } from 'vitest'
import { configPreviewOf } from '@/pages/TwinEditor/scripts/configPreview'
it('部件预览只包含选中部件的节点，并保持原配置', () => {
  const config = normalizeTwinConfig({
    parts: [
      { id: 'a', name: '水泵', nodes: ['pump'] },
      { id: 'b', nodes: ['wall'] },
    ],
  })
  const before = JSON.stringify(config)
  const preview = configPreviewOf(config, { kind: 'parts', id: 'a' }, null)
  expect(preview.nodes).toEqual(['pump'])
  expect(preview.title).toBe('部件预览 · 水泵')
  expect(preview.config.parts.map((part) => part.id)).toEqual(['a'])
  expect(JSON.stringify(config)).toBe(before)
})
it('视点预览使用被选中机位及视野', () => {
  const config = normalizeTwinConfig({
    cameras: [
      {
        id: 'a',
        name: '机房',
        position: [1, 2, 3],
        target: [4, 5, 6],
        fov: 60,
      },
    ],
  })
  const preview = configPreviewOf(config, { kind: 'cameras', id: 'a' }, null)
  expect(preview.view).toEqual({
    position: [1, 2, 3],
    target: [4, 5, 6],
    fov: 60,
  })
  expect(preview.nodes).toBeUndefined()
})
it('信息牌预览只保留当前牌，并保留其锚点关联', () => {
  const config = normalizeTwinConfig({
    anchors: [{ id: 'anchor', position: [5, 6, 7] }],
    panels: [
      { id: 'a', name: '温度牌', anchorId: 'anchor', fields: [{ key: 't' }] },
      { id: 'b' },
    ],
  })
  const preview = configPreviewOf(config, { kind: 'panels', id: 'a' }, null)
  expect(preview.title).toBe('信息牌预览 · 温度牌')
  expect(preview.config.panels.map((item) => item.id)).toEqual(['a'])
  expect(preview.config.anchors.map((item) => item.id)).toContain('anchor')
})
