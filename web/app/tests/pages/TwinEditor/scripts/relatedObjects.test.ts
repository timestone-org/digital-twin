/** @fileoverview 关联导航只使用配置引用或实际动画节点，不按名称猜。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { expect, it } from 'vitest'
import {
  relatedObjects,
  selectedObjectLabel,
} from '@/pages/TwinEditor/scripts/relatedObjects'
const config = normalizeTwinConfig({
  parts: [
    { id: 'p', name: '主机', nodes: ['mesh'], click: { cameraId: 'camera' } },
    { id: 'child', parentId: 'p' },
  ],
  cameras: [{ id: 'camera', name: '取景' }],
  anchors: [{ id: 'a' }],
  panels: [{ id: 'panel', anchorId: 'a' }],
  flows: [{ id: 'flow', pathAnchors: ['a'] }],
})
it('部件可导航到子件、视点和实际节点关联动画', () => {
  const clips = [
    { name: 'spin', nodes: ['mesh'], duration: 1, ambiguous: false },
  ]
  expect(
    relatedObjects(config, { kind: 'parts', id: 'p' }, clips, null).map(
      (item) => item.value,
    ),
  ).toEqual(['parts:child', 'cameras:camera', 'animation:spin'])
  expect(
    relatedObjects(config, { kind: 'model' }, clips, 'spin').map(
      (item) => item.value,
    ),
  ).toEqual(['parts:p'])
  expect(
    relatedObjects(config, { kind: 'parts', id: 'child' }, [], null)[0]?.value,
  ).toBe('parts:p')
})
it('信息牌、锚点、能量流和视点按引用双向导航', () => {
  expect(
    relatedObjects(config, { kind: 'panels', id: 'panel' }, [], null).map(
      (item) => item.value,
    ),
  ).toEqual(['anchors:a'])
  expect(
    relatedObjects(config, { kind: 'anchors', id: 'a' }, [], null).map(
      (item) => item.value,
    ),
  ).toEqual(['panels:panel', 'flows:flow'])
  expect(
    relatedObjects(config, { kind: 'flows', id: 'flow' }, [], null)[0]?.value,
  ).toBe('anchors:a')
  expect(
    relatedObjects(config, { kind: 'cameras', id: 'camera' }, [], null)[0]
      ?.value,
  ).toBe('parts:p')
  expect(relatedObjects(config, { kind: 'model' }, [], null)).toEqual([])
  expect(
    relatedObjects(config, { kind: 'parts', id: 'missing' }, [], null),
  ).toEqual([])
  expect(selectedObjectLabel(config, { kind: 'parts', id: 'p' }, null)).toBe(
    '部件 · 主机',
  )
  expect(selectedObjectLabel(config, { kind: 'model' }, null)).toBe(
    '模型与场景',
  )
})
