/** @fileoverview 部署编辑表单按当前记录回填，并将回填值作为干净基准。 */
import { DtInput, DtModal, DtNumberInput, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import DeploymentFormDialog from '@/pages/Modeling/Services/components/DeploymentFormDialog.vue'
import { deployment } from '@/testing/modelingTemplateFixtures'

const wrappers: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

function open() {
  const wrapper = mount(DeploymentFormDialog, {
    props: { deployment, isBusy: false, versions: [] },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

function nameInput(wrapper: VueWrapper) {
  const input = wrapper
    .findAllComponents(DtInput)
    .find((field) => field.props('label') === '名称')
  if (!input) throw new Error('缺少部署名称字段')
  return input.get('input')
}

it('首次打开时回填部署配置且表单尚未修改', () => {
  const wrapper = open()
  expect(nameInput(wrapper).element.value).toBe(deployment.name)
  expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe(
    deployment.model_version_id,
  )
  expect(
    wrapper
      .findAllComponents(DtNumberInput)
      .map((field) => field.props('modelValue')),
  ).toEqual([deployment.max_rows_per_call, deployment.rate_limit_per_minute])
  expect(wrapper.findComponent(DtModal).props('dirty')).toBe(false)
})

it('切换部署后回填新配置并重建干净基准', async () => {
  const wrapper = open()
  await nameInput(wrapper).setValue('尚未保存的修改')
  expect(wrapper.findComponent(DtModal).props('dirty')).toBe(true)
  await wrapper.setProps({
    deployment: {
      ...deployment,
      id: 'another-deployment',
      code: 'another-model',
      name: '第二个部署',
      model_version_id: 'another-version',
      max_rows_per_call: 500,
      rate_limit_per_minute: 120,
    },
  })
  expect(nameInput(wrapper).element.value).toBe('第二个部署')
  expect(wrapper.findComponent(DtSelect).props('modelValue')).toBe(
    'another-version',
  )
  expect(
    wrapper
      .findAllComponents(DtNumberInput)
      .map((field) => field.props('modelValue')),
  ).toEqual([500, 120])
  expect(wrapper.findComponent(DtModal).props('dirty')).toBe(false)
})
