/** @fileoverview JSON 导入的文件校验、预检提示、表单提交与异步取消。 */
import type {
  ModelingImportInspection,
  ModelingPipeline,
  ModelingTransferDocument,
} from '@dt/contracts'
import { DtFilePicker, DtInput, DtModal } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import * as api from '@/api/modelingTransfer'
import { BizError } from '@/api/client'
import * as idempotency from '@/api/idempotency'
import PipelineImportDialog from '@/pages/Modeling/Pipelines/components/PipelineImportDialog.vue'
import { usePipelineTransfer } from '@/pages/Modeling/Pipelines/scripts/usePipelineTransfer'
import * as downloads from '@/utils/downloadJson'

const document: ModelingTransferDocument = {
  format_version: '1.0',
  pipeline: {
    code: 'energy',
    name: '能耗分析',
    description: '说明',
    graph: { format_version: '1.0', nodes: [], edges: [] },
  },
  operators: [],
}
const result: ModelingImportInspection = {
  document,
  can_import: true,
  issues: [],
  node_count: 0,
  edge_count: 0,
  source_table_codes: [],
}
const created: ModelingPipeline = {
  id: 'imported',
  code: 'energy_copy',
  name: '导入副本',
  description: '说明',
  graph: document.pipeline.graph,
  node_count: 0,
  source_table_codes: [],
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  created_by_name: '分析员',
}
const done = vi.fn()
const wrappers: VueWrapper[] = []

function open() {
  const wrapper = mount(
    defineComponent({
      components: { PipelineImportDialog },
      setup() {
        const transfer = usePipelineTransfer(done)
        transfer.isOpen.value = true
        return { transfer }
      },
      template: '<PipelineImportDialog :transfer="transfer" />',
    }),
    { global: { stubs: { teleport: true } } },
  )
  wrappers.push(wrapper)
  return { wrapper, state: wrapper.vm.transfer }
}

function file(
  name = 'pipeline.json',
  content = JSON.stringify(document),
): File {
  return new File([content], name, { type: 'application/json' })
}

function pending<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('未初始化')
  }
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.spyOn(idempotency, 'newIdempotencyKey').mockReturnValue('attempt-key')
  done.mockClear()
  vi.spyOn(api, 'inspectPipelineImport').mockResolvedValue(result)
  vi.spyOn(api, 'importPipeline').mockResolvedValue(created)
  vi.spyOn(api, 'exportPipeline').mockResolvedValue(document)
  vi.spyOn(downloads, 'downloadJson').mockImplementation(() => undefined)
})
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

it('选择文件后展示预检，允许修改新名称和编码并导入独立设计', async () => {
  const { wrapper, state } = open()
  expect(state.canSubmit.value).toBe(false)
  wrapper.getComponent(DtFilePicker).vm.$emit('select', [file()])
  await flushPromises()
  expect(wrapper.text()).toContain('可以导入')
  expect(wrapper.text()).toContain('不覆盖当前系统中的已有内容')
  const fields = wrapper.findAllComponents(DtInput)
  const name = fields.find((item) => item.props('label') === '工作流名称')
  const code = fields.find((item) => item.props('label') === '新工作流编码')
  if (!name || !code) throw new Error('缺少导入字段')
  await name.get('input').setValue('异地能耗分析')
  const currentCode = wrapper
    .findAllComponents(DtInput)
    .find((item) => item.props('label') === '新工作流编码')
  if (!currentCode) throw new Error('缺少编码输入框')
  await currentCode.get('input').setValue('energy_copy')
  expect(state.code.value).toBe('energy_copy')
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(api.importPipeline).toHaveBeenCalledExactlyOnceWith(
    {
      document,
      code: 'energy_copy',
      name: '异地能耗分析',
      description: '说明',
    },
    'attempt-key',
    expect.any(AbortSignal),
  )
  expect(done).toHaveBeenCalledWith('imported')
  expect(state.isOpen.value).toBe(false)
})

it.each([
  ['bad.txt', '{}', '请选择 JSON 文件'],
  ['bad.json', 'not json', '不是有效的 JSON'],
  ['large.json', 'x'.repeat(2 * 1024 * 1024 + 1), '不能超过 2 MB'],
])('拒绝无效文件 %s，预检不发出请求', async (name, text, message) => {
  const { wrapper, state } = open()
  await state.select([file(name, text)])
  expect(wrapper.text()).toContain(message)
  expect(api.inspectPipelineImport).not.toHaveBeenCalled()
  expect(state.canSubmit.value).toBe(false)
})

it('阻断问题与节点提示可读，不能绕过按钮直接提交', async () => {
  vi.mocked(api.inspectPipelineImport).mockResolvedValue({
    ...result,
    can_import: false,
    issues: [
      { level: 'error', node_id: 'source', message: '当前系统没有算子' },
    ],
  })
  const { wrapper, state } = open()
  await state.select([file()])
  expect(wrapper.text()).toContain('阻止导入')
  expect(wrapper.text()).toContain('节点 source')
  await wrapper.get('form').trigger('submit')
  expect(api.importPipeline).not.toHaveBeenCalled()
})

it('版本和数据源警告保留可导入状态，编码或名称无效时禁止提交', async () => {
  vi.mocked(api.inspectPipelineImport).mockResolvedValue({
    ...result,
    issues: [{ level: 'warning', message: '请核对数据源' }],
  })
  const { wrapper, state } = open()
  await state.select([file()])
  expect(wrapper.text()).toContain('待核对')
  expect(state.canSubmit.value).toBe(true)
  state.code.value = '!bad'
  await flushPromises()
  expect(wrapper.text()).toContain('首位为字母或数字')
  expect(state.canSubmit.value).toBe(false)
  state.code.value = 'correct'
  state.name.value = ' '
  expect(state.canSubmit.value).toBe(false)
})

it('编码冲突保留表单和原文档，可改编码后重新提交', async () => {
  vi.mocked(api.importPipeline).mockRejectedValueOnce(
    new BizError(41402, '这个流水线编码已经被占用了', 409, 'trace'),
  )
  const { wrapper, state } = open()
  await state.select([file()])
  await state.submit()
  expect(wrapper.text()).toContain('编码已经被占用')
  expect(state.isOpen.value).toBe(true)
  expect(state.inspection.value?.document).toEqual(document)
  state.code.value = 'new_code'
  await state.submit()
  expect(done).toHaveBeenCalledOnce()
})

it('响应丢失后原样重试保留幂等键，修改逻辑请求才分配新键', async () => {
  vi.mocked(idempotency.newIdempotencyKey)
    .mockReturnValueOnce('first-attempt')
    .mockReturnValueOnce('changed-attempt')
  vi.mocked(api.importPipeline).mockRejectedValue(new Error('response lost'))
  const { state } = open()
  await state.select([file()])
  await state.submit()
  await state.submit()
  state.code.value = 'different_code'
  await state.submit()
  expect(
    vi.mocked(api.importPipeline).mock.calls.map((call) => call[1]),
  ).toEqual(['first-attempt', 'first-attempt', 'changed-attempt'])
  expect(idempotency.newIdempotencyKey).toHaveBeenCalledTimes(2)
  expect(done).not.toHaveBeenCalled()
})

it('选入文件后的多字段表单阻止误关，并保留手工编辑内容', async () => {
  const { wrapper, state } = open()
  expect(wrapper.getComponent(DtModal).props('dirty')).toBe(false)
  await state.select([file()])
  state.code.value = 'hand_written_code'
  state.name.value = '手工名称'
  await flushPromises()
  expect(wrapper.getComponent(DtModal).props('dirty')).toBe(true)
  await wrapper.get('.dt-modal__backdrop').trigger('click')
  expect(state.isOpen.value).toBe(true)
  expect(state.code.value).toBe('hand_written_code')
  expect(state.name.value).toBe('手工名称')
})

it('快速切换文件只接受最后一次预检，关闭后丢弃在途响应', async () => {
  const first = pending<ModelingImportInspection>()
  const second = pending<ModelingImportInspection>()
  vi.mocked(api.inspectPipelineImport)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const { state } = open()
  const firstRun = state.select([file('first.json')])
  await flushPromises()
  const secondRun = state.select([file('second.json')])
  await flushPromises()
  second.resolve({
    ...result,
    document: {
      ...document,
      pipeline: { ...document.pipeline, name: '最后选的文件' },
    },
  })
  await secondRun
  first.resolve(result)
  await firstRun
  expect(state.name.value).toBe('最后选的文件')
  const late = pending<ModelingImportInspection>()
  vi.mocked(api.inspectPipelineImport).mockReturnValueOnce(late.promise)
  const lateRun = state.select([file()])
  await flushPromises()
  state.close()
  late.resolve(result)
  await lateRun
  expect(state.inspection.value).toBeNull()
  expect(state.isReading.value).toBe(false)
})

it('提交期间阻止关闭、重复提交和换文件，导出仅下载已保存定义', async () => {
  const saving = pending<ModelingPipeline>()
  vi.mocked(api.importPipeline).mockReturnValueOnce(saving.promise)
  const { wrapper, state } = open()
  await state.select([file()])
  const running = state.submit()
  state.close()
  await state.submit()
  await state.select([file('another.json')])
  expect(state.isOpen.value).toBe(true)
  expect(api.importPipeline).toHaveBeenCalledOnce()
  await flushPromises()
  expect(wrapper.getComponent(DtFilePicker).props('disabled')).toBe(true)
  saving.resolve(created)
  await running
  await state.exportSaved(created)
  expect(api.exportPipeline).toHaveBeenCalledWith(
    'imported',
    expect.any(AbortSignal),
  )
  expect(downloads.downloadJson).toHaveBeenCalledWith(
    document,
    'energy_copy_工作流',
  )
})
