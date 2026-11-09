/** @fileoverview Blender 材质预览的环境光、色彩变换与异步资源生命周期。 */
import * as THREE from 'three'
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js'

export type EnvironmentLoader = (signal: AbortSignal) => Promise<THREE.Texture>

/** 环境图下载的总时限，毫秒。 */
const ENVIRONMENT_TIMEOUT_MS = 15_000

type DecodedEnvironment = ReturnType<EXRLoader['parse']>

/**
 * 解好的环境图像素，全应用共用一份；失败时清空，下一次重新加载。
 * ⚠ 不缓存的话每个场景、每开一次详情弹窗都在主线程上解一遍 DWAB，卡顿按场景数叠加。
 */
let decoded: Promise<DecodedEnvironment> | null = null

/** 下载并解码一次；⚠ 不接调用方的取消信号，一个场景卸载不能作废别人在等的那份。 */
async function fetchAndDecode(): Promise<DecodedEnvironment> {
  const response = await fetch(
    new URL('./assets/forest.exr', import.meta.url),
    { signal: AbortSignal.timeout(ENVIRONMENT_TIMEOUT_MS) },
  )
  if (!response.ok) throw new Error('环境光资源加载失败')
  return new EXRLoader().parse(await response.arrayBuffer())
}

function decodedEnvironment(): Promise<DecodedEnvironment> {
  decoded ??= fetchAndDecode().catch((error: unknown) => {
    decoded = null
    throw error
  })
  return decoded
}

function abortError(): DOMException {
  return new DOMException('环境光加载已取消', 'AbortError')
}

/**
 * 等共用的那份，但调用方一取消就先撤。
 * @param promise 共用的解码结果
 * @param signal 调用方自己的取消信号
 */
function unlessAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/** 加载随应用发布的 CC0 环境图；每次给一张新纹理，调用方各自释放。 */
export const loadStudioEnvironment: EnvironmentLoader = async (signal) => {
  const parsed = await unlessAborted(decodedEnvironment(), signal)
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

/** 只给测试用：丢掉共用的解码结果。 */
export function __resetStudioEnvironment(): void {
  decoded = null
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
