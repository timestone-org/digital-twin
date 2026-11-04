/** @fileoverview 部署版本按后端页检索并保留固定版本标签。 */
import type { Page, ModelingVersionSummary } from '@dt/contracts'
import { DtSelect } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as modeling from '@/api/modeling'
import DeploymentVersionPicker from '@/pages/Modeling/Services/components/DeploymentVersionPicker.vue'
import {
  deployment,
  version,
  versionSummary,
} from '@/testing/modelingTemplateFixtures'

const wrappers: VueWrapper[] = []
function page(
  items: ModelingVersionSummary[],
  total = items.length,
): Page<ModelingVersionSummary> {
  return { items, page: 1, size: 20, total }
}
function open() {
  const wrapper = mount(DeploymentVersionPicker, {
    props: {
      deployment,
      modelValue: deployment.model_version_id,
      disabled: false,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.spyOn(modeling, 'getModelingVersion').mockResolvedValue({
    ...version,
    id: deployment.model_version_id,
  })
  vi.spyOn(modeling, 'listModelingVersions').mockResolvedValue(
    page([versionSummary], 401),
  )
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
it('打开只读取固定版本和第一页，不自动扫完目录且禁用本地搜索', async () => {
  const wrapper = open()
  await flushPromises()
  expect(modeling.getModelingVersion).toHaveBeenCalledWith(
    deployment.model_version_id,
    expect.any(AbortSignal),
  )
  expect(modeling.listModelingVersions).toHaveBeenCalledOnce()
  expect(modeling.listModelingVersions).toHaveBeenCalledWith(
    {
      page: 1,
      size: 20,
      q: '',
      pipelineId: version.pipeline_id,
      task: version.task,
      isServable: true,
      archived: 'active',
    },
    expect.any(AbortSignal),
  )
  expect(wrapper.getComponent(DtSelect).props('display')).toEqual({
    searchable: false,
  })
  expect(wrapper.text()).toContain(`${version.name} v${version.version}`)
  expect(wrapper.get('nav[aria-label="可切换模型版本分页"]').text()).toContain(
    '401',
  )
})

it('后端检索从第一页开始，当前固定版本不在结果页仍保留标签', async () => {
  const remote = { ...versionSummary, id: 'remote', name: '服务端按算法命中' }
  vi.mocked(modeling.listModelingVersions).mockResolvedValue(page([remote], 41))
  const wrapper = open()
  await flushPromises()
  const next = wrapper
    .findAll('button')
    .find((button) => button.text() === '下一页')
  await next?.trigger('click')
  await flushPromises()
  await wrapper
    .get('input[aria-label="搜索可切换模型版本"]')
    .setValue('  算法关键字  ')
  await wrapper.get('button[aria-label="搜索可切换模型版本"]').trigger('click')
  await flushPromises()
  expect(modeling.listModelingVersions).toHaveBeenLastCalledWith(
    {
      page: 1,
      size: 20,
      q: '算法关键字',
      pipelineId: version.pipeline_id,
      task: version.task,
      isServable: true,
      archived: 'active',
    },
    expect.any(AbortSignal),
  )
  const options = wrapper.getComponent(DtSelect).props('options')
  expect(options).toEqual(
    expect.arrayContaining([
      {
        value: deployment.model_version_id,
        label: `${version.name} v${version.version}`,
        disabled: false,
      },
      { value: 'remote', label: '服务端按算法命中 v1', disabled: false },
    ]),
  )
  expect(
    wrapper
      .get('input[aria-label="搜索可切换模型版本"]')
      .attributes('maxlength'),
  ).toBe('128')
})

it('切换后端结果页也保留已选新版本，不把未在本页当成不存在', async () => {
  const first = { ...versionSummary, id: 'picked', name: '已选模型' }
  vi.mocked(modeling.listModelingVersions)
    .mockResolvedValueOnce(page([first], 41))
    .mockResolvedValue(
      page([{ ...versionSummary, id: 'other', name: '其他页模型' }], 41),
    )
  const wrapper = open()
  await flushPromises()
  wrapper.getComponent(DtSelect).vm.$emit('update:modelValue', 'picked')
  await wrapper.setProps({ modelValue: 'picked' })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '下一页')
    ?.trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(DtSelect).props('options')).toEqual(
    expect.arrayContaining([
      { value: 'picked', label: '已选模型 v1', disabled: false },
    ]),
  )
  expect(wrapper.emitted('update:modelValue')).toEqual([['picked']])
})

it('快速检索取消旧请求并丢弃迟到选项', async () => {
  let signal: AbortSignal | undefined
  let finish: ((result: Page<ModelingVersionSummary>) => void) | undefined
  vi.mocked(modeling.listModelingVersions).mockImplementation((query, given) =>
    query?.q === 'slow'
      ? new Promise((resolve) => {
          signal = given
          finish = resolve
        })
      : Promise.resolve(
          page([
            {
              ...versionSummary,
              id: 'new',
              name: query?.q === 'fast' ? '最新选项' : '初始选项',
            },
          ]),
        ),
  )
  const wrapper = open()
  await flushPromises()
  await wrapper.get('input[aria-label="搜索可切换模型版本"]').setValue('slow')
  await wrapper.get('button[aria-label="搜索可切换模型版本"]').trigger('click')
  await flushPromises()
  await wrapper.get('input[aria-label="搜索可切换模型版本"]').setValue('fast')
  await wrapper.get('button[aria-label="搜索可切换模型版本"]').trigger('click')
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  finish?.(page([{ ...versionSummary, id: 'old', name: '迟到选项' }]))
  await flushPromises()
  expect(wrapper.getComponent(DtSelect).props('options')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: 'new', label: '最新选项 v1' }),
    ]),
  )
  expect(wrapper.getComponent(DtSelect).props('options')).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ value: 'old' })]),
  )
})

it('当前固定版本读取失败保留错误并可显式重试，不扫描未知工作流', async () => {
  vi.mocked(modeling.getModelingVersion).mockRejectedValueOnce(
    new Error('offline'),
  )
  const wrapper = open()
  await flushPromises()
  expect(wrapper.text()).toContain('当前模型版本加载失败')
  expect(modeling.listModelingVersions).not.toHaveBeenCalled()
  await wrapper.get('button[aria-label="重试当前模型版本"]').trigger('click')
  await flushPromises()
  expect(modeling.getModelingVersion).toHaveBeenCalledTimes(2)
  expect(modeling.listModelingVersions).toHaveBeenCalledOnce()
})

it('切换部署时取消旧固定版本读取，迟到上下文不能串入新工作流', async () => {
  let signal: AbortSignal | undefined
  let finish: ((value: typeof version) => void) | undefined
  vi.mocked(modeling.getModelingVersion)
    .mockImplementationOnce((_id, given) => {
      signal = given
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    .mockResolvedValue({
      ...version,
      id: 'fresh',
      pipeline_id: 'new-workflow',
      name: '新固定版本',
    })
  const wrapper = open()
  await flushPromises()
  await wrapper.setProps({
    deployment: { ...deployment, model_version_id: 'fresh' },
    modelValue: 'fresh',
  })
  await flushPromises()
  expect(signal?.aborted).toBe(true)
  finish?.({ ...version, name: '迟到固定版本' })
  await flushPromises()
  expect(modeling.listModelingVersions).toHaveBeenLastCalledWith(
    expect.objectContaining({ pipelineId: 'new-workflow' }),
    expect.any(AbortSignal),
  )
  expect(wrapper.getComponent(DtSelect).props('options')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        value: 'fresh',
        label: `新固定版本 v${version.version}`,
      }),
    ]),
  )
  expect(wrapper.getComponent(DtSelect).props('options')).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ label: `迟到固定版本 v${version.version}` }),
    ]),
  )
})
