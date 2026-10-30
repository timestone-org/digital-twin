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

it('历史配置迟到时不能覆盖切换后的模型与保存修订号', async () => {
  let finish: ((value: ModelingConfigurationDetail) => void) | undefined
  vi.spyOn(api, 'getInstanceConfiguration').mockImplementation(
    (id, _signal, runId) => {
      if (runId)
        return new Promise((resolve) => {
          finish = resolve
        })
      return Promise.resolve({
        ...configuration,
        instance: { ...model, id, revision: id === 'i2' ? 3 : 1 },
        configuration: { nodes: { source: { table_code: id } } },
      })
    },
  )
  vi.spyOn(api, 'getInstance').mockImplementation((id) =>
    Promise.resolve({ ...model, id }),
  )
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
  const id = ref('i1')
  let editor: ReturnType<typeof useInstanceEditor> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useInstanceEditor(id)
        return () => h('div')
      },
    }),
  )
  if (!editor) throw new Error('组件未装配')
  await editor.load()
  const pending = editor.restore('old-run')
  id.value = 'i2'
  await editor.load()
  if (!finish) throw new Error('历史请求未发出')
  finish(configuration)
  await pending
  expect(editor.instance.value?.id).toBe('i2')
  expect(editor.parsed.value.value?.nodes['source']).toEqual({
    table_code: 'i2',
  })
  expect(editor.baselineRevision.value).toBe(3)
  expect(editor.sourceRunId.value).toBe('')
  wrapper.unmount()
})

it('保存期间切换模型会解除新模型忙态，旧保存不能清掉新保存忙态', async () => {
  const pending: ((value: ModelingInstance) => void)[] = []
  vi.spyOn(api, 'getInstanceConfiguration').mockImplementation((id) =>
    Promise.resolve({ ...configuration, instance: { ...model, id } }),
  )
  vi.spyOn(api, 'getInstance').mockImplementation((id) =>
    Promise.resolve({ ...model, id }),
  )
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
  vi.spyOn(api, 'configureInstance').mockImplementation(
    () =>
      new Promise((resolve) => {
        pending.push(resolve)
      }),
  )
  const id = ref('i1')
  let editor: ReturnType<typeof useInstanceEditor> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useInstanceEditor(id)
        return () => h('div')
      },
    }),
  )
  if (!editor) throw new Error('组件未装配')
  await editor.load()
  const oldSave = editor.save()
  id.value = 'i2'
  await editor.load()
  expect(editor.busy.value).toBe(false)
  id.value = 'i1'
  await editor.load()
  const newSave = editor.save()
  expect(pending).toHaveLength(2)
  pending[0]?.(model)
  await oldSave
  expect(editor.busy.value).toBe(true)
  pending[1]?.(model)
  await newSave
  expect(editor.busy.value).toBe(false)
  wrapper.unmount()
})

it('新模型加载失败后不展示旧模型配置，也不能向新模型保存旧草稿', async () => {
  vi.spyOn(api, 'getInstanceConfiguration').mockImplementation((id) =>
    id === 'i2'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(configuration),
  )
  vi.spyOn(api, 'getInstance').mockResolvedValue(model)
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
  const save = vi.spyOn(api, 'configureInstance').mockResolvedValue(model)
  const id = ref('i1')
  let editor: ReturnType<typeof useInstanceEditor> | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        editor = useInstanceEditor(id)
        return () => h('div')
      },
    }),
  )
  if (!editor) throw new Error('组件未装配')
  await editor.load()
  editor.change('source', 'table_code', 'old-private-draft')
  id.value = 'i2'
  await editor.load()
  expect(editor.instance.value).toBeNull()
  expect(editor.draft.value).toBe('')
  await editor.save()
  expect(save).not.toHaveBeenCalled()
  wrapper.unmount()
})
