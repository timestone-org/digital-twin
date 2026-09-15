/** @fileoverview 配置对象取景保留锚点偏移和完整能量流路径。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { expect, it } from 'vitest'
import { previewTargetBox } from '../src/previewActions'
it('信息牌聚焦锚点加偏移，路径取景覆盖所有节点', () => {
  const config = normalizeTwinConfig({
    anchors: [
      { id: 'a', position: [10, 20, 30] },
      { id: 'b', position: [100, 200, 300] },
    ],
    panels: [{ id: 'p', anchorId: 'a', offset: [1, 2, 3] }],
    flows: [{ id: 'f', pathAnchors: ['a', 'b'] }],
  })
  const box = previewTargetBox(config, { kind: 'panels', id: 'p' }, 100)
  expect(box?.min.toArray()).toEqual([8.5, 19.5, 30.5])
  expect(box?.max.toArray()).toEqual([13.5, 24.5, 35.5])
  const flow = previewTargetBox(config, { kind: 'flows', id: 'f' }, 100)
  expect(flow?.min.toArray()).toEqual([9, 19, 29])
  expect(flow?.max.toArray()).toEqual([101, 201, 301])
  expect(
    previewTargetBox(config, { kind: 'panels', id: 'missing' }, 100),
  ).toBeNull()
  expect(previewTargetBox(config, { kind: 'model' }, 100)).toBeNull()
  expect(previewTargetBox(config, null, 100)).toBeNull()
})
it('不能解析的路径不生成错误包围盒', () => {
  const config = normalizeTwinConfig({
    flows: [{ id: 'f', pathAnchors: ['missing'] }],
  })
  expect(previewTargetBox(config, { kind: 'flows', id: 'f' }, 0)).toBeNull()
})
