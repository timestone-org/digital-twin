/** @fileoverview 配置与乐观版本来自同一快照，状态刷新不能偷换保存版本。 */
import type {
  ModelingConfigurationDetail,
  ModelingInstance,
} from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import * as api from '@/api/modelingTemplates'
import * as modeling from '@/api/modeling'
import { useInstanceEditor } from '@/pages/Modeling/Instance/scripts/useInstanceEditor'

const model: ModelingInstance = {
  id: 'i1',
  code: 'model-1',
  name: '实例',
  description: null,
  template_id: 't1',
  template_name: '模板',
  template_version: 1,
  revision: 1,
  latest_run: null,
  created_at: '2026-10-27T00:00:00.000Z',
  updated_at: '2026-10-27T00:00:00.000Z',
}
const configuration: ModelingConfigurationDetail = {
  instance: model,
  configuration: { nodes: { source: { table_code: 'first' } } },
  nodes: [],
  json_schema: {},
}

afterEach(() => vi.restoreAllMocks())

it('后台元数据更新到 r2 后，旧草稿仍携带 r1 保存并由后端判冲突', async () => {
  vi.spyOn(api, 'getInstanceConfiguration').mockResolvedValue(configuration)
  vi.spyOn(api, 'getInstance').mockResolvedValue({ ...model, revision: 2 })
  vi.spyOn(modeling, 'listModelingRuns').mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue({
    items: [],
    page: 1,
    size: 20,
    total: 0,
  })
  const save = vi
    .spyOn(api, 'configureInstance')
    .mockResolvedValue({ ...model, revision: 2 })
  let editor: ReturnType<typeof useInstanceEditor> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useInstanceEditor(ref('i1'))
        return () => h('div')
      },
    }),
  )
  if (!editor) throw new Error('组件未装配')
  await editor.load()
  await flushPromises()
  expect(editor.instance.value?.revision).toBe(2)
  editor.change('source', 'table_code', 'my-edit')
  await editor.save()
  expect(save).toHaveBeenCalledWith('i1', {
    expected_revision: 1,
    configuration: { nodes: { source: { table_code: 'my-edit' } } },
    name: '实例',
    description: null,
  })
  wrapper.unmount()
})
