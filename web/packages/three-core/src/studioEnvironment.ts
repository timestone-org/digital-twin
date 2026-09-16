/** @fileoverview Blender 材质预览的环境光、色彩变换与异步资源生命周期。 */
import * as THREE from 'three'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'

export type EnvironmentLoader = (signal: AbortSignal) => Promise<THREE.Texture>

/** 加载随应用发布的 CC0 环境图。 */
export const loadStudioEnvironment: EnvironmentLoader = async (signal) => {
  const response = await fetch(
    new URL('./assets/forest.exr', import.meta.url),
    {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  )
  if (!response.ok) throw new Error('环境光资源加载失败')
  const parsed = new EXRLoader().parse(await response.arrayBuffer())
  const texture = new THREE.DataTexture(
    parsed.data,
    parsed.width,
    parsed.height,
    parsed.format,
    parsed.type,
  )
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/** 装配与 Blender AgX / exposure 0 对应的输出变换。 */
export function configureStudioColor(renderer: {
  toneMapping: THREE.ToneMapping
  toneMappingExposure: number
  outputColorSpace: string
}): void {
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
}

/** 环境图成功后替换补光；取消后的迟到纹理必须立即释放。 */
export function attachStudioEnvironment(
  scene: THREE.Scene,
  fallback: THREE.Group,
  load: EnvironmentLoader,
): () => void {
  const controller = new AbortController()
  scene.userData['environmentStatus'] = 'loading'
  void load(controller.signal)
    .then((texture) => {
      if (controller.signal.aborted) {
        texture.dispose()
        return
      }
      texture.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = texture
      scene.environmentIntensity = 1
      fallback.visible = false
      scene.userData['environmentStatus'] = 'ready'
    })
    .catch(() => {
      if (!controller.signal.aborted)
        scene.userData['environmentStatus'] = 'fallback'
    })
  return () => controller.abort()
}
