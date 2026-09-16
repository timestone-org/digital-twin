/** @fileoverview 环境光加载成功、失败、卸载竞态与内置 EXR 的解码契约。 */
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attachStudioEnvironment,
  loadStudioEnvironment,
} from '../src/studioEnvironment'

afterEach(() => vi.unstubAllGlobals())

it('加载失败保留补光并标记降级', async () => {
  const scene = new THREE.Scene()
  const fallback = new THREE.Group()
  const cancel = attachStudioEnvironment(scene, fallback, () =>
    Promise.reject(new Error('unavailable')),
  )
  await vi.waitFor(() =>
    expect(scene.userData['environmentStatus']).toBe('fallback'),
  )
  expect(fallback.visible).toBe(true)
  expect(scene.environment).toBeNull()
  cancel()
})

it('卸载后迟到的纹理释放且不写回场景', async () => {
  const scene = new THREE.Scene()
  const texture = new THREE.Texture()
  const dispose = vi.spyOn(texture, 'dispose')
  let finish: (texture: THREE.Texture) => void = () => {}
  const pending = new Promise<THREE.Texture>((resolve) => {
    finish = resolve
  })
  const cancel = attachStudioEnvironment(
    scene,
    new THREE.Group(),
    () => pending,
  )
  cancel()
  finish(texture)
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce())
  expect(scene.environment).toBeNull()
})

it('内置环境图解码为线性 HDR 且遵循 EXR 的上下方向', async () => {
  const bytes = await readFile('packages/three-core/src/assets/forest.exr')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes)))
  const texture = await loadStudioEnvironment(new AbortController().signal)
  expect(texture).toBeInstanceOf(THREE.DataTexture)
  expect(texture.colorSpace).toBe(THREE.LinearSRGBColorSpace)
  expect(texture.flipY).toBe(false)
  expect(texture.type).toBe(THREE.HalfFloatType)
  texture.dispose()
})

it('环境图 HTTP 失败不交给解码器', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
  )
  await expect(
    loadStudioEnvironment(new AbortController().signal),
  ).rejects.toThrow('环境光资源加载失败')
})
