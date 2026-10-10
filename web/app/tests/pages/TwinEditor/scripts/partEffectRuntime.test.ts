/** @fileoverview 真实派生求值的采样元数据让设备效果在断线时停止，常量效果仍可预览。 */
import { registerBuiltinModules, getModule } from '@dt/modules'
import { computeValue } from '@dt/datasources'
import { computeModuleValues, type BindingValueReader } from '@dt/runtime'
import { fakeBinding } from '@dt/runtime/testing'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'

const scene = vi.hoisted(() => ({
  TwinScene: {
    name: 'TwinSceneStub',
    props: ['config', 'values', 'navigationMode'],
    template: '<div />',
  },
}))
vi.mock('@dt/three-core', () => scene)

it('实时派生效果断线停止，纯常量派生效果保持原值', async () => {
  registerBuiltinModules()
  const manifest = getModule('twin-view')
  if (manifest === undefined) throw new Error('孪生模块未登记')
  const read: BindingValueReader = (binding, siblings) => {
    if (binding.computeJson !== null)
      return { state: 'ok', value: computeValue(binding.computeJson, siblings) }
    return binding.sourceKind === 'static'
      ? { state: 'ok', value: binding.staticValueJson }
      : { state: 'ok', value: 1, timestampMs: 100 }
  }
  const evaluated = computeModuleValues({
    specs: manifest.bindings,
    read,
    bindings: [
      fakeBinding({
        id: 'signal',
        fieldKey: 'anchorValues[0].value',
        sourceKind: 'opcua',
      }),
      fakeBinding({
        id: 'constant',
        fieldKey: 'anchorValues[1].value',
        sourceKind: 'static',
        staticValueJson: 1,
      }),
      fakeBinding({
        id: 'signal-effect',
        fieldKey: 'partEffectValues[0].value',
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['anchorValues[0].value'] },
      }),
      fakeBinding({
        id: 'constant-effect',
        fieldKey: 'partEffectValues[1].value',
        sourceKind: 'computed',
        computeJson: { op: 'sum', inputs: ['anchorValues[1].value'] },
      }),
    ],
  })
  const component = (await manifest.component()).default
  const wrapper = mount(component, {
    props: {
      config: {
        twin: {
          anchors: [{ id: 'signal' }, { id: 'constant' }],
          parts: [
            { id: 'pump', effect: { enabled: true } },
            { id: 'constant', effect: { enabled: true } },
          ],
        },
      },
      values: evaluated.values,
      meta: { slots: evaluated.slots, connectionState: 'open' },
    },
  })
  await flushPromises()
  expect(wrapper.getComponent(scene.TwinScene).props('values')).toEqual(
    expect.objectContaining({
      effectParts: { pump: { value: 1 }, constant: { value: 1 } },
    }),
  )
  await wrapper.setProps({
    meta: { slots: evaluated.slots, connectionState: 'closed' },
  })
  expect(wrapper.getComponent(scene.TwinScene).props('values')).toEqual(
    expect.objectContaining({ effectParts: { constant: { value: 1 } } }),
  )
})
