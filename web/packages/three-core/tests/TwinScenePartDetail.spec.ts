/** @fileoverview 模型装载结果与部件详情弹窗的生命周期。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import * as THREE from 'three'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { configureTwinModelHost, resetTwinModelHost } from '../src/host'
import type { TwinModelAsset } from '../src/modelLoader'
import type * as SceneCoreModule from '../src/sceneCore'
import { createHeadlessRenderer } from '../src/testing/createHeadlessRenderer'
import TwinPartModal from '../src/TwinPartModal.vue'
import TwinScene from '../src/TwinScene.vue'

const seams = vi.hoisted(() => ({
  createWebGLRenderer: vi.fn(),
  loadTwinModel: vi.fn(),
}))

vi.mock('../src/sceneCore', async (importOriginal) => {
  const actual = await importOriginal<typeof SceneCoreModule>()
  return { ...actual, createWebGLRenderer: seams.createWebGLRenderer }
})

vi.mock('../src/modelLoader', () => ({
  createGltfSource: vi.fn(),
  loadTwinModel: seams.loadTwinModel,
}))

const ORIGINAL = 'asset:0192f0aa-0000-7000-8000-000000000001'
const REPLACEMENT = 'asset:0192f0aa-0000-7000-8000-000000000002'
const BROKEN = 'asset:0192f0aa-0000-7000-8000-000000000003'

function sceneConfig(asset: string) {
  return normalizeTwinConfig({
    model: { asset },
    parts: [
      { id: 'fixture', nodes: ['FixturePart'], detail: { showModel: false } },
    ],
  })
}

function loadedAsset(): TwinModelAsset {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.name = 'FixturePart'
  root.add(mesh)
  return { root, clips: [] }
}

beforeEach(() => {
  seams.createWebGLRenderer.mockImplementation(() => createHeadlessRenderer())
  seams.loadTwinModel.mockImplementation(() => Promise.resolve(loadedAsset()))
  configureTwinModelHost({ resolveModelUrl: (ref) => `/audit/${ref}.glb` })
})

afterEach(() => {
  vi.restoreAllMocks()
  seams.createWebGLRenderer.mockReset()
  seams.loadTwinModel.mockReset()
  resetTwinModelHost()
})

it('成功换模保留详情，装载失败后关闭，恢复时可再次打开', async () => {
  const action = { sequence: 1, partId: 'fixture', kind: 'detail' } as const
  const scene = mount(TwinScene, {
    props: { config: sceneConfig(ORIGINAL), previewAction: action },
    attachTo: document.body,
  })
  try {
    await flushPromises()
    const modal = scene.getComponent(TwinPartModal)
    expect(modal.props('part')).toMatchObject({ id: 'fixture' })

    await scene.setProps({ config: sceneConfig(REPLACEMENT) })
    await flushPromises()
    expect(modal.props('part')).toMatchObject({ id: 'fixture' })
    expect(scene.emitted('partDetailClose')).toBeUndefined()

    seams.loadTwinModel.mockRejectedValueOnce(new Error('模型素材不可用'))
    await scene.setProps({ config: sceneConfig(BROKEN) })
    await flushPromises()
    expect(scene.text()).toContain('模型素材不可用')
    expect(modal.props('part')).toBeNull()
    expect(scene.emitted('partDetailClose')).toHaveLength(1)

    await scene.setProps({
      config: sceneConfig(ORIGINAL),
      previewAction: null,
    })
    await flushPromises()
    expect(modal.props('part')).toBeNull()
    await scene.setProps({ previewAction: { ...action, sequence: 2 } })
    expect(modal.props('part')).toMatchObject({ id: 'fixture' })
  } finally {
    scene.unmount()
  }
})
