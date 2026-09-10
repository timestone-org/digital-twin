/** @fileoverview 真实左栏操作经页面事件监听写入文档的契约。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { DOMWrapper, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TwinLeftPane from '@/pages/TwinEditor/components/TwinLeftPane.vue'
import { createTwinDoc } from '@/pages/TwinEditor/scripts/twinDoc'
import { createTwinEditorActions } from '@/pages/TwinEditor/scripts/twinEditorActions'
import type { OutlinePlacement } from '@/pages/TwinEditor/scripts/outlinePlacement'
import type { TwinEntityKind } from '@/pages/TwinEditor/scripts/types'

function setup() {
  const doc = createTwinDoc({
    config: normalizeTwinConfig({
      anchors: [{ id: 'a' }, { id: 'b' }],
      folders: [{ id: 'f', kind: 'anchors', name: '文件夹', itemIds: ['b'] }],
    }),
    bindings: [],
  })
  const actions = createTwinEditorActions(doc, () => undefined)
  const wrapper = mount(TwinLeftPane, {
    props: {
      config: doc.config.value,
      selection: null,
      flaggedIds: new Set<string>(),
    },
    attrs: {
      onAddInFolder: (payload: { kind: TwinEntityKind; folderId: string }) =>
        actions.add(payload.kind, payload.folderId),
      onPlace: (payload: OutlinePlacement) => actions.place(payload),
      onMoveIntoFolder: (payload: { folderId: string; id: string }) =>
        actions.moveIntoFolder(payload.folderId, payload.id),
    },
  })
  function row(id: string) {
    const element = wrapper
      .get(`[data-test="outline-row"][data-id="${id}"]`)
      .element.closest('[draggable="true"]')
    if (element === null) throw new Error('缺少拖动行')
    return new DOMWrapper(element)
  }
  return { doc, wrapper, row }
}

describe('文件夹实际操作', () => {
  it('点击夹内新建会创建实体并归入文件夹', async () => {
    const { doc, wrapper } = setup()
    await wrapper.get('[data-test="folder-add"]').trigger('click')
    expect(doc.config.value.anchors).toHaveLength(3)
    expect(doc.config.value.folders[0]?.itemIds).toHaveLength(2)
    wrapper.unmount()
  })
  it('拖到夹内成员后面会同时入夹和排序', async () => {
    const { doc, wrapper, row } = setup()
    await row('a').trigger('dragstart')
    await row('b').trigger('dragover', { clientY: 1 })
    await row('b').trigger('drop')
    expect(doc.config.value.folders[0]?.itemIds).toContain('a')
    expect(doc.config.value.anchors.map((item) => item.id)).toEqual(['b', 'a'])
    wrapper.unmount()
  })
  it('拖到文件夹标题会直接入夹', async () => {
    const { doc, wrapper, row } = setup()
    await row('a').trigger('dragstart')
    const folder = wrapper.get('[data-test="outline-folder"]')
    await folder.trigger('dragover')
    await folder.trigger('drop')
    expect(doc.config.value.folders[0]?.itemIds).toContain('a')
    wrapper.unmount()
  })
})
