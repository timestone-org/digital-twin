/** @fileoverview 预览随选中切换并传递隔离节点、机位和临时动画配置。 */
import { TwinScene } from '@dt/three-core'
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinFocusView } from '@dt/twin-config'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { DtSegmented } from '@dt/ui'
import TwinPreviewControls from '@/pages/TwinEditor/components/TwinPreviewControls.vue'
import TwinPreviewData from '@/pages/TwinEditor/components/TwinPreviewData.vue'
import TwinConfigPreview from '@/pages/TwinEditor/components/TwinConfigPreview.vue'
vi.mock('@dt/three-core', async () => {
  const { defineComponent } = await import('vue')
  return {
    TwinPanelPreview: defineComponent({
      name: 'PanelPreview',
      props: { panel: Object, values: Object },
      template: '<div data-test="card" />',
    }),
    TwinScene: defineComponent({
      name: 'PreviewScene',
      props: {
        config: Object,
        values: Object,
        previewNodes: Array,
        previewAction: Object,
        previewTarget: Object,
        focusView: Object,
      },
      template: '<div data-test="scene" />',
    }),
  }
})
const config = normalizeTwinConfig({
  parts: [{ id: 'pump', nodes: ['pump-mesh'] }],
  cameras: [{ id: 'view', position: [1, 2, 3], target: [0, 0, 0] }],
})
it('直接打开独立视角编辑，应用和恢复时保持弹窗宿主，关闭后清除请求', async () => {
  const config = normalizeTwinConfig({
    parts: [
      { id: 'pump', nodes: ['pump'] },
      { id: 'child', parentId: 'pump' },
    ],
  })
  const wrapper = mount(TwinConfigPreview, {
    props: {
      node: null,
      config,
      selection: { kind: 'parts', id: 'pump' },
      animation: null,
      testMode: 'live',
      bindings: [],
      readBinding: () => () => ({ state: 'pending' }),
    },
  })
  await flushPromises()
  wrapper.vm.editPartDetailView('pump')
  await flushPromises()
  const scene = wrapper.findComponent(TwinScene)
  expect(scene.props('previewAction')).toMatchObject({
    partId: 'pump',
    kind: 'detail-edit',
  })
  const change: { partId: string; view: TwinFocusView } = {
    partId: 'child',
    view: { position: [11, 2, 3], target: [10, 0, 0], fov: 50 },
  }
  scene.vm.$emit('partDetailView', change)
  expect(wrapper.emitted('partDetailView')?.at(-1)).toEqual([change])
  for (const view of [change.view, null]) {
    await wrapper.setProps({
      config: normalizeTwinConfig({
        ...config,
        parts: config.parts.map((part) => ({
          ...part,
          detail: { ...part.detail, view },
        })),
      }),
    })
    expect(wrapper.findComponent({ name: 'PreviewScene' }).element).toBe(
      scene.element,
    )
  }
  scene.vm.$emit('partDetailClose')
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toBeNull()
  wrapper.unmount()
})

it('旧部件的编辑请求不打开当前部件，切换对象清除编辑请求', async () => {
  const wrapper = mount(TwinConfigPreview, {
    props: {
      node: null,
      config,
      selection: { kind: 'parts', id: 'pump' },
      animation: null,
      testMode: 'live',
      bindings: [],
      readBinding: () => () => ({ state: 'pending' }),
    },
  })
  await flushPromises()
  wrapper.vm.editPartDetailView('missing')
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toBeNull()
  wrapper.vm.editPartDetailView('pump')
  await flushPromises()
  await wrapper.setProps({ selection: { kind: 'cameras', id: 'view' } })
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toBeNull()
  wrapper.unmount()
})

it('详情预览读取自己的视角，恢复默认时重新取景', async () => {
  const view = { position: [11, 2, 3], target: [10, 0, 0], fov: 50 }
  const config = normalizeTwinConfig({
    parts: [{ id: 'pump', nodes: ['pump'], detail: { view } }],
  })
  const wrapper = mount(TwinConfigPreview, {
    props: {
      node: null,
      config,
      selection: { kind: 'parts', id: 'pump' },
      animation: null,
      testMode: 'live',
      bindings: [],
      readBinding: () => () => ({ state: 'pending' }),
    },
  })
  await flushPromises()
  wrapper
    .findComponent(TwinPreviewControls)
    .vm.$emit('update:partMode', 'detail')
  await flushPromises()
  const scene = wrapper.findComponent({ name: 'PreviewScene' })
  expect(scene.props('focusView')).toEqual(view)
  await wrapper.setProps({
    config: normalizeTwinConfig({
      ...config,
      parts: config.parts.map((part) => ({
        ...part,
        detail: { ...part.detail, view: null },
      })),
    }),
  })
  const resetScene = wrapper.findComponent({ name: 'PreviewScene' })
  expect(resetScene.props('focusView')).toBeNull()
  expect(resetScene.element).not.toBe(scene.element)
  wrapper.unmount()
})
it('默认跟随配置，改变部件与视点后更新预览，关闭后选中对象再次打开', async () => {
  const wrapper = mount(TwinConfigPreview, {
    props: {
      node: null,
      config,
      selection: { kind: 'parts', id: 'pump' },
      animation: null,
      testMode: 'live',
      bindings: [],
      readBinding: () => () => ({ state: 'pending' }),
    },
    global: { stubs: { TwinRuntimePreview: true } },
  })
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewNodes'),
  ).toEqual(['pump-mesh'])
  await wrapper.get('[aria-label="放大配置预览"]').trigger('click')
  expect(wrapper.classes()).toContain('config-preview--wide')
  await wrapper.setProps({ selection: { kind: 'cameras', id: 'view' } })
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('focusView'),
  ).toEqual({ position: [1, 2, 3], target: [0, 0, 0], fov: 45 })
  await wrapper.get('[aria-label="关闭配置预览"]').trigger('click')
  expect(wrapper.find('[data-test="scene"]').exists()).toBe(false)
  await wrapper.get('button').trigger('click')
  await flushPromises()
  wrapper.findComponent(DtSegmented).vm.$emit('update:modelValue', 'runtime')
  await flushPromises()
  expect(wrapper.find('twin-runtime-preview-stub').exists()).toBe(true)
  await wrapper.setProps({
    animation: {
      name: 'spin',
      nodes: ['pump-mesh'],
      duration: 1,
      ambiguous: false,
    },
    testMode: 'play',
  })
  await flushPromises()
  expect(wrapper.text()).toContain('动画预览 · spin')
  expect(wrapper.text()).toContain('临时试播')
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('config'),
  ).toMatchObject({ model: { animations: { controls: [{ mode: 'always' }] } } })
  await wrapper.setProps({ testMode: 'pause' })
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('config'),
  ).toMatchObject({
    model: { animations: { controls: [{ missing: 'pause' }] } },
  })
  await wrapper.setProps({ testMode: 'reset' })
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('config'),
  ).toMatchObject({
    model: { animations: { controls: [{ missing: 'reset' }] } },
  })
  await wrapper.setProps({
    testMode: 'live',
    animation: null,
    selection: { kind: 'model' },
  })
  expect(wrapper.text()).toContain('场景配置预览')
  wrapper.unmount()
})

it('详情卡片和模拟字段同步，切换对象清除模拟覆盖', async () => {
  const config = normalizeTwinConfig({
    parts: [
      {
        id: 'p',
        name: '泵',
        nodes: ['pump'],
        detail: { title: '泵详情', fields: [{ key: 't', label: '温度' }] },
      },
      { id: 'q', nodes: ['other'] },
    ],
  })
  const wrapper = mount(TwinConfigPreview, {
    props: {
      node: null,
      config,
      selection: { kind: 'parts', id: 'p' },
      animation: null,
      testMode: 'live',
      bindings: [],
      readBinding: () => () => ({ state: 'pending' }),
    },
  })
  await flushPromises()
  wrapper
    .findComponent(TwinPreviewControls)
    .vm.$emit('update:partMode', 'detail')
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PanelPreview' }).props('panel'),
  ).toMatchObject({ id: 'p', fields: [{ key: 't' }] })
  expect(wrapper.text()).toContain('泵详情')
  wrapper.findComponent(TwinPreviewData).vm.$emit('update:enabled', true)
  wrapper
    .findComponent(TwinPreviewData)
    .vm.$emit('write', { key: 'partFields:p::t', value: 42 })
  await flushPromises()
  expect(wrapper.text()).toContain('模拟数据预览')
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('values'),
  ).toMatchObject({ partFields: { 'p::t': { value: 42 } } })
  expect(
    wrapper.findComponent({ name: 'PanelPreview' }).props('values'),
  ).toEqual({ 'p::t': { value: 42 } })
  wrapper.findComponent(TwinPreviewControls).vm.$emit('action', 'detail')
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toMatchObject({ partId: 'p', kind: 'detail' })
  await wrapper.setProps({ selection: { kind: 'parts', id: 'q' } })
  expect(wrapper.findComponent(TwinPreviewData).props('enabled')).toBe(false)
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toBeNull()
  expect(config.parts[0]?.detail.fields[0]?.staticText).toBe('')
  wrapper.unmount()
})
it('单段漫游使用选中段，右侧预览命令只交给预览场景', async () => {
  const config = normalizeTwinConfig({
    cameras: [
      { id: 'a', position: [10, 0, 0] },
      { id: 'b', position: [0, 10, 0] },
      { id: 'c', position: [0, 0, 10] },
    ],
    roamTour: { items: ['a', 'b', 'c'], loop: true },
  })
  const wrapper = mount(TwinConfigPreview, {
    props: {
      node: null,
      config,
      selection: { kind: 'roam' },
      animation: null,
      testMode: 'live',
      bindings: [],
      readBinding: () => () => ({ state: 'pending' }),
    },
  })
  await flushPromises()
  wrapper
    .findComponent(TwinPreviewControls)
    .vm.$emit('update:segmentKey', 'b:c')
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('config'),
  ).toMatchObject({
    roamTour: {
      items: ['b', 'c'],
      loop: false,
      enabled: true,
      autoplay: false,
    },
  })
  wrapper.vm.playRoam()
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toMatchObject({ kind: 'roam-play' })
  wrapper
    .findComponent(TwinScene)
    .vm.$emit('roamProgress', { segmentIndex: 0, percent: 50, playing: true })
  await flushPromises()
  expect(wrapper.text()).toContain('50%')
  expect(wrapper.emitted('roamPlaying')?.at(-1)).toEqual([true])
  wrapper.vm.showPartMode('click')
  wrapper.vm.stopRoam()
  await flushPromises()
  expect(
    wrapper.findComponent({ name: 'PreviewScene' }).props('previewAction'),
  ).toMatchObject({ kind: 'roam-stop' })
  wrapper.unmount()
})
