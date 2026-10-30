/** @fileoverview 线上试算的任务路由、输入校验、停用状态与竞态隔离。 */
import type { OpenModelPredict } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BizError } from '@/api/client'
import * as api from '@/api/modelingServing'
import DeploymentTrial from '@/pages/Modeling/Services/components/DeploymentTrial.vue'
import { deployment } from '@/testing/modelingTemplateFixtures'

const signature = {
  output: { task: 'regression' },
  inputs: [
    {
      key: 'temperature',
      label: '温度',
      unit: '℃',
      dtype: 'number',
      is_required: true,
    },
  ],
  requires_timestamp: true,
}
const answer: OpenModelPredict = {
  model: { code: deployment.code, version: 1 },
  predictions: [42],
  warnings: [],
}
const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(api, 'getOpenModelSignature').mockResolvedValue(signature)
  vi.spyOn(api, 'callOpenModel').mockResolvedValue(answer)
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
})
async function open(
  over: Partial<typeof deployment> = {},
): Promise<VueWrapper> {
  const wrapper = mount(DeploymentTrial, {
    props: { deployment: { ...deployment, ...over } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
const run = (wrapper: VueWrapper) => wrapper.get('button')

it.each([
  ['regression', 'predict'],
  ['classification', 'predict'],
  ['anomaly_detection', 'detect'],
  ['rule_calculation', 'calculate'],
])('按签名任务 %s 调用 %s 并展示结果与字段提示', async (task, action) => {
  vi.mocked(api.getOpenModelSignature).mockResolvedValue({
    ...signature,
    output: { task },
  })
  const wrapper = await open()
  expect(wrapper.text()).toContain('temperature')
  expect(wrapper.text()).toContain('必填')
  expect(wrapper.text()).toContain('__ts__')
  const rows = [{ temperature: 26, __ts__: '2026-10-30T00:00:00Z' }]
  await wrapper.get('textarea').setValue(JSON.stringify({ rows }))
  await run(wrapper).trigger('click')
  await flushPromises()
  expect(api.callOpenModel).toHaveBeenCalledWith(
    deployment.code,
    action,
    rows,
    expect.any(AbortSignal),
  )
  expect(wrapper.get('[aria-label="试算结果"]').text()).toContain('42')
})

it.each([
  ['{', 'JSON 格式不完整'],
  ['[]', 'rows'],
  ['{"rows":[]}', '1–200'],
  ['{"rows":[null]}', '每一行都必须是对象'],
  ['{"rows":[{"temperature":true}]}', '只接受数字、文本或 null'],
  ['{"rows":[{}],"other":1}', 'rows'],
])('无效输入 %s 禁止发起试算', async (text, reason) => {
  const wrapper = await open()
  await wrapper.get('textarea').setValue(text)
  expect(wrapper.text()).toContain(reason)
  expect(run(wrapper).attributes('disabled')).toBeDefined()
  await run(wrapper).trigger('click')
  expect(api.callOpenModel).not.toHaveBeenCalled()
})

it('行数上限来自当前部署配额', async () => {
  const wrapper = await open({ max_rows_per_call: 1 })
  await wrapper.get('textarea').setValue('{"rows":[{},{}]}')
  expect(wrapper.text()).toContain('1–1')
  expect(run(wrapper).attributes('disabled')).toBeDefined()
})

it.each([{ is_enabled: false }, { is_servable: false }])(
  '不可调用部署 %o 不读取签名、不提交试算',
  async (over) => {
    const wrapper = await open(over)
    expect(api.getOpenModelSignature).not.toHaveBeenCalled()
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(run(wrapper).attributes('disabled')).toBeDefined()
  },
)

it('无法识别的签名不能按默认任务误调接口', async () => {
  vi.mocked(api.getOpenModelSignature).mockResolvedValue({
    ...signature,
    output: { task: 'future_task' },
  })
  const wrapper = await open()
  expect(wrapper.text()).toContain('未声明可识别的任务类型')
  expect(run(wrapper).attributes('disabled')).toBeDefined()
  expect(api.callOpenModel).not.toHaveBeenCalled()
})

it('签名加载失败可重试，试算业务失败保留输入并展示原因', async () => {
  vi.mocked(api.getOpenModelSignature).mockRejectedValueOnce(
    new Error('签名暂不可用'),
  )
  const wrapper = await open()
  expect(wrapper.text()).toContain('签名暂不可用')
  const retry = wrapper
    .findAll('button')
    .find((button) => button.text() === '重新读取签名')
  if (!retry) throw new Error('没有重试入口')
  await retry.trigger('click')
  await flushPromises()
  vi.mocked(api.callOpenModel).mockRejectedValueOnce(
    new BizError(41423, 'temperature 是必填输入', 400, 'test'),
  )
  const text = '{"rows":[{}]}'
  await wrapper.get('textarea').setValue(text)
  await run(wrapper).trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('temperature 是必填输入')
  expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe(text)
  expect(run(wrapper).attributes('disabled')).toBeUndefined()
})

it('切换部署时丢弃旧签名的迟到响应', async () => {
  let finish: ((value: unknown) => void) | undefined
  vi.mocked(api.getOpenModelSignature).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = await open()
  const signal = vi.mocked(api.getOpenModelSignature).mock.calls[0]?.[1]
  await wrapper.setProps({
    deployment: {
      ...deployment,
      code: 'next-model',
      model_version_id: 'next-version',
    },
  })
  await flushPromises()
  if (!finish) throw new Error('签名未请求')
  finish({ output: { task: 'old_unknown_task' }, inputs: [] })
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  expect(wrapper.text()).not.toContain('未声明可识别')
  expect(wrapper.text()).toContain('next-model:predict')
})

it('切换部署后旧试算结果不能覆盖新部署', async () => {
  let finish: ((value: OpenModelPredict) => void) | undefined
  vi.mocked(api.callOpenModel).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = await open()
  await wrapper.get('textarea').setValue('{"rows":[{"temperature":26}]}')
  await run(wrapper).trigger('click')
  const signal = vi.mocked(api.callOpenModel).mock.calls[0]?.[3]
  await wrapper.setProps({ deployment: { ...deployment, code: 'next-model' } })
  await flushPromises()
  if (!finish) throw new Error('试算未提交')
  finish(answer)
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  expect(wrapper.find('[aria-label="试算结果"]').exists()).toBe(false)
  expect(run(wrapper).attributes('disabled')).toBeUndefined()
})

it('卸载时取消签名与试算，完成的请求不再更新页面', async () => {
  let finish: ((value: OpenModelPredict) => void) | undefined
  vi.mocked(api.callOpenModel).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const wrapper = await open()
  await run(wrapper).trigger('click')
  const signal = vi.mocked(api.callOpenModel).mock.calls[0]?.[3]
  wrapper.unmount()
  if (!finish) throw new Error('试算未提交')
  finish(answer)
  await flushPromises()
  expect(signal?.aborted).toBe(true)
})
